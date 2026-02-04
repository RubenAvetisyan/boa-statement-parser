# boa-statement-parser

A production-ready Node.js library and CLI for parsing Bank of America bank statement PDFs into clean, normalized, categorized JSON with full JSON Schema validation.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Multi-format support**: Parses checking, savings, and credit card statements
- **Transaction Details PDFs**: Parses "Print Transaction Details" exports from BOA Online Banking
- **Multi-statement PDFs**: Extracts multiple statements from combined PDF files
- **Batch directory processing**: Process entire directories of PDFs with `--inputDir`
- **Smart deduplication**: Statement-level and transaction-level dedup with completeness scoring
- **Automatic detection**: Identifies account type from statement content
- **Transaction categorization**: 70+ priority-ordered rules with confidence tiers
- **ML-based categorization**: TensorFlow.js with Universal Sentence Encoder for intelligent categorization
- **Channel detection**: Identifies CHECKCARD, ATM, Zelle, Online Banking transfers, etc.
- **Bank reference extraction**: Captures confirmation numbers, trace numbers, ATM IDs
- **Merchant extraction**: Extracts merchant name, city, state, and online flag
- **Recurring transaction detection**: Identifies subscriptions, regular bills, and recurring payments
- **JSON Schema validation**: AJV-based validation against Draft 2020-12 schema
- **Wrapped line handling**: Merges multi-line descriptions from PDF extraction
- **Strict validation**: Optional schema validation with Zod
- **Idempotent output**: Same input always produces same output
- **TypeScript-first**: Full type safety with strict mode

## Installation

```bash
# Install globally from npm
npm install -g boa-statement-parser

# Or install locally in your project
npm install boa-statement-parser
```

## Quick Start

### Initialize Your Project

After installing, run the init command to set up required files:

```bash
# Initialize with .env file and pre-trained ML model
parse-boa init

# Skip ML model (if you don't need ML categorization)
parse-boa init --no-model

# Overwrite existing files
parse-boa init --force
```

This creates:
- `.env` - Configuration file with sensible defaults
- `models/categorizer/` - Pre-trained ML model for transaction categorization
- `statements/` - Directory to place your PDF files

### CLI Usage

```bash
# Parse a single statement PDF
pnpm parse-boa ./statement.pdf

# Save output to a file
pnpm parse-boa ./statement.pdf --out result.json

# Enable verbose mode for debugging
pnpm parse-boa ./statement.pdf --verbose

# Enable strict validation
pnpm parse-boa ./statement.pdf --strict

# Compact JSON output (no pretty-printing)
pnpm parse-boa ./statement.pdf --no-pretty
```

### Batch Directory Processing

Process multiple PDF files from a directory:

```bash
# Process all PDFs in a directory
pnpm parse-boa --inputDir "C:\Users\...\Statements" --out result.json

# With verbose output showing progress
pnpm parse-boa --inputDir ./statements --out result.json --verbose

# With strict validation
pnpm parse-boa --inputDir ./statements --out result.json --strict --verbose
```

Batch processing features:
- Scans directory for `*.pdf` files (case-insensitive)
- Skips temporary files (`~$...`) and zero-byte files
- Processes files in deterministic order (sorted by filename)
- Deduplicates statements across all PDFs
- Produces single consolidated output matching single-PDF schema

### Programmatic Usage

```typescript
import { parseStatementFile } from 'boa-statement-parser';

const result = await parseStatementFile('./statement.pdf', {
  strict: true,
  verbose: false,
});

console.log(result.statement.transactions);
```

### Advanced Usage

```typescript
import { extractPDF, parseBoaStatement, detectAccountType } from 'boa-statement-parser';

// Extract PDF content
const pdf = await extractPDF('./statement.pdf');

// Detect account type
const accountType = detectAccountType(pdf);
console.log(`Detected: ${accountType}`); // 'checking' | 'credit' | 'unknown'

// Parse with options
const result = parseBoaStatement(pdf, {
  strict: true,
  verbose: true,
});

// Access parsed data
console.log(result.statement.account);
console.log(result.statement.summary);
console.log(result.statement.transactions);
console.log(result.statement.metadata.warnings);
```

## Output JSON Schema

The output conforms to JSON Schema Draft 2020-12. See `schemas/final_result.v1.schema.json` and `schemas/final_result.v2.schema.json` for the full schemas.

```typescript
{
  "schemaVersion": "1.0.0",
  "source": {
    "fileName": "statement.pdf",
    "fileType": "pdf",
    "pageCount": 4
  },
  "statements": [{
    "statementId": "sha256-hash-32-chars",
    "account": {
      "institution": "Bank of America",
      "accountType": "checking" | "credit",
      "accountNumberMasked": "****1234",
      "currency": "USD",
      "statementPeriod": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
    },
    "summary": {
      "beginningBalance": number,
      "endingBalance": number,
      "totalCredits": number,
      "totalDebits": number,
      "transactionCount": number
    },
    "transactions": [{
      "transactionId": "sha256-hash-32-chars",
      "date": "YYYY-MM-DD",
      "postedDate": "YYYY-MM-DD" | null,
      "amount": number,
      "direction": "debit" | "credit",
      "description": "cleaned description",
      "descriptionRaw": "original line from PDF",
      "merchant": {
        "name": "STARBUCKS",
        "normalizedName": "Starbucks",
        "city": "SEATTLE",
        "state": "WA",
        "online": false,
        "network": "VISA" | null
      },
      "bankReference": {
        "cardTransactionTraceNumber": "24801975260482319110911",
        "confirmationNumber": "1234567890",
        "zelleConfirmation": "T0ZDL3WND",
        "atmId": "000009733",
        "checkNumber": "1234"
      },
      "channel": {
        "type": "CHECKCARD" | "ATM_DEPOSIT" | "ATM_WITHDRAWAL" | "ZELLE" | 
               "ONLINE_BANKING_TRANSFER" | "CHECK" | "FEE" | "OTHER",
        "subtype": "transfer_from_sav" | null
      },
      "categorization": {
        "category": "Food & Dining",
        "subcategory": "Restaurants",
        "confidence": 0.85,
        "ruleId": "food-restaurant",
        "rationale": "Matched rule: food-restaurant"
      },
      "raw": {
        "page": 1,
        "section": "deposits" | "atm_debit" | "checks" | "service_fees" | null,
        "originalText": "01/05 STARBUCKS STORE 12345 5.75"
      },
      "flags": {
        "isTransfer": true,
        "isSubscription": false
      }
    }],
    "provenance": {
      "extractedFromText": true,
      "pageStart": 1,
      "pageEnd": 4
    }
  }],
  "metadata": {
    "parser": { "name": "boa-statement-parser", "version": "1.0.0" },
    "parsedAt": "2024-01-15T10:30:00.000Z",
    "warnings": []
  }
}
```

## Supported PDF Formats

The parser supports two types of Bank of America PDF documents:

### Monthly Statement PDFs

Traditional monthly bank statements downloaded from BOA Online Banking or received by mail. These contain:
- Account summary with beginning/ending balances
- Transaction history organized by type (deposits, withdrawals, checks, fees)
- Statement period information

### Transaction Details PDFs ("Print Transaction Details")

Web page exports from BOA Online Banking's "Print Transaction Details" feature. These contain:
- Custom date range transaction history
- Account activity from the online banking portal
- Useful for exporting transactions outside of monthly statement periods

**Format characteristics:**
- Header: `Bank of America | Online Banking | Deposit | Print Transaction Details`
- Account line: `Adv Plus Banking - 3529 : Account Activity` or `Advantage Savings - 4971 : Account Activity`
- Date range: `Showing results for "All Transactions, MM/DD/YYYY To MM/DD/YYYY"`

Both formats are automatically detected and can be processed together in batch mode:

```bash
# Process a directory containing both monthly statements and transaction details PDFs
pnpm parse-boa --inputDir ./statements --out result.json
```

## Channel Types

The parser detects and classifies transaction channels:

| Channel Type | Description | Example |
|--------------|-------------|---------|
| `CHECKCARD` | Debit card purchases | `CHECKCARD 0105 STARBUCKS...` |
| `ATM_DEPOSIT` | ATM cash/check deposits | `BKOFAMERICA ATM #000009733 DEPOSIT` |
| `ATM_WITHDRAWAL` | ATM cash withdrawals | `BKOFAMERICA ATM WITHDRWL` |
| `ONLINE_BANKING_TRANSFER` | Online transfers | `Online Banking transfer from SAV Confirmation#...` |
| `ZELLE` | Zelle payments | `Zelle payment from JOHN DOE Conf#...` |
| `CHECK` | Check payments | Check number extracted |
| `FEE` | Bank fees | `Monthly Maintenance Fee` |
| `FINANCIAL_CENTER_DEPOSIT` | Branch deposits | `FINANCIAL CENTER DEPOSIT` |
| `OTHER` | Unclassified | Fallback |

## Confidence Tiers

Categorization uses three confidence levels:

| Tier | Confidence | Description |
|------|------------|-------------|
| HIGH | 0.95 | Exact merchant match (Netflix, Uber, etc.) |
| MEDIUM | 0.75-0.85 | Keyword match with context |
| LOW | 0.50 | Uncategorized (no rule matched) |

## Transaction Categories

The parser includes 70+ priority-ordered categorization rules covering:

| Category | Subcategories |
|----------|---------------|
| Income | Salary, Interest, Dividends, Refund |
| Housing | Rent, Mortgage, HOA, Property Tax |
| Utilities | Electric, Gas, Water, Internet, Phone |
| Transportation | Rideshare, Gas, Parking, Tolls, Insurance |
| Food & Dining | Groceries, Restaurants, Food Delivery, Alcohol |
| Shopping | Online, General Merchandise, Electronics, Clothing |
| Entertainment | Streaming, Movies, Events, Fitness, Gaming |
| Health | Pharmacy, Medical, Dental, Vision, Insurance |
| Financial | ATM, Deposit, Check, Credit Card Payment, Investment, Loan Payment |
| Transfer | Zelle, Venmo, Internal, Wire, ACH |
| Fees | Bank |
| Travel | Flights, Lodging, Car Rental |
| Education | Tuition, Learning |
| Personal Care | Grooming, Beauty |
| Insurance | Life, Renters |
| Taxes | Tax Payment, Tax Preparation |
| Charity | Donation |
| Pets | Pet Care |
| Childcare | Daycare |

Uncategorized transactions receive a confidence score of 0.5.

## ML-Based Categorization

The parser includes an optional machine learning-based categorizer using TensorFlow.js and Universal Sentence Encoder for intelligent transaction categorization.

### Architecture

- **Text Embeddings**: Universal Sentence Encoder generates 512-dimensional embeddings from transaction descriptions
- **Neural Network**: Multi-output classifier predicts both category and subcategory
- **Hybrid Approach**: Combines rule-based and ML categorization for best results

### Usage

```typescript
import { HybridCategorizer, generateTrainingData } from 'boa-statement-parser';

// Initialize hybrid categorizer
const categorizer = new HybridCategorizer();
await categorizer.initialize();

// Train with synthetic data (or your own labeled transactions)
const trainingData = generateTrainingData(5000);
await categorizer.trainML(trainingData, { epochs: 50 });

// Categorize with hybrid approach
const result = await categorizer.categorizeAsync('STARBUCKS COFFEE SEATTLE WA', 'CHECKCARD');
console.log(result.category);    // 'Food & Dining'
console.log(result.subcategory); // 'Restaurants'
console.log(result.source);      // 'rule' | 'ml' | 'hybrid'

// Clean up
categorizer.dispose();
```

### Hybrid Strategy

1. **Rule-first**: Fast, deterministic rule-based categorization runs first
2. **High confidence bypass**: If rule confidence ≥ 0.9, use rule result directly
3. **ML validation**: For medium confidence (0.75-0.9), ML validates/overrides
4. **ML fallback**: For uncategorized transactions, ML provides predictions
5. **Confidence combination**: When rule and ML agree, confidences are combined

### Training Data Generation

The `generateTrainingData()` function creates synthetic training examples from:
- 100+ merchant templates across all categories
- Data augmentation (prefixes, cities, store numbers)
- Existing rule-based patterns

```typescript
import { generateTrainingData, generateFromParsedTransactions } from 'boa-statement-parser';

// Generate synthetic training data
const syntheticData = generateTrainingData(5000);

// Or use your own labeled transactions
const customData = generateFromParsedTransactions([
  { description: 'MY LOCAL COFFEE SHOP', category: 'Food & Dining', subcategory: 'Restaurants' },
  // ... more examples
]);
```

### Model Persistence

```typescript
// Save trained model
await categorizer.saveMLModel('./models/categorizer');

// Load pre-trained model
const newCategorizer = new HybridCategorizer();
await newCategorizer.loadMLModel('./models/categorizer');
```

### Performance Notes

- First prediction is slower due to model warm-up
- Batch predictions (`predictBatch`) are more efficient for multiple transactions
- Consider installing `@tensorflow/tfjs-node` for faster CPU inference

### CLI Usage for ML Training

```bash
# Train ML model using synthetic data only
pnpm parse-boa --train-ml --model-out ./models/categorizer

# Train ML model from your parsed statements (recommended)
pnpm parse-boa --train-ml --inputDir ./statements --model-out ./models/categorizer

# Train with more epochs for better accuracy
pnpm parse-boa --train-ml --inputDir ./statements --model-out ./models/categorizer --epochs 100 --verbose
```

The training process:
1. Parses all PDFs in the input directory
2. Extracts categorized transactions as training examples
3. Augments with synthetic data for better coverage
4. Trains the neural network
5. Saves the model to the specified path

## Recurring Transaction Detection

The parser can detect recurring transactions such as subscriptions, regular bills, and periodic payments.

### CLI Usage

```bash
# Detect recurring transactions
pnpm parse-boa --inputDir ./statements --detect-recurring --out result.json

# With verbose output showing detection stats
pnpm parse-boa --inputDir ./statements --detect-recurring --verbose --out result.json
```

### Environment Variable

```bash
# Enable via .env file
BOA_DETECT_RECURRING=true
```

### Detected Frequencies

| Frequency | Interval Range |
|-----------|----------------|
| `weekly` | 5-9 days |
| `bi-weekly` | 12-16 days |
| `monthly` | 26-35 days |
| `quarterly` | 85-100 days |
| `semi-annual` | 170-200 days |
| `annual` | 350-380 days |
| `irregular` | High variance or outside ranges |

### Output Structure

When `--detect-recurring` is enabled, a `recurring` object is added to the JSON output:

```json
{
  "recurring": {
    "patterns": [
      {
        "patternId": "rec_debit_abc123",
        "merchantKey": "netflix",
        "merchantName": "NETFLIX.COM",
        "frequency": "monthly",
        "averageIntervalDays": 30.5,
        "intervalStdDev": 1.2,
        "averageAmount": 15.99,
        "amountVariance": 0,
        "isFixedAmount": true,
        "category": "Entertainment",
        "subcategory": "Streaming",
        "direction": "debit",
        "occurrenceCount": 6,
        "firstSeen": "2025-01-15",
        "lastSeen": "2025-06-15",
        "expectedNext": "2025-07-15",
        "confidence": 0.95,
        "isSubscription": true,
        "transactionIds": ["tx_abc123...", "tx_def456..."]
      }
    ],
    "summary": {
      "totalPatterns": 5,
      "totalRecurringTransactions": 30,
      "recurringPercentage": 15.5,
      "estimatedMonthlyRecurring": 125.50,
      "estimatedAnnualRecurring": 1506.00,
      "byFrequency": {
        "weekly": 0,
        "bi-weekly": 1,
        "monthly": 3,
        "quarterly": 1,
        "semi-annual": 0,
        "annual": 0,
        "irregular": 0
      },
      "subscriptionCount": 3
    }
  }
}
```

### Subscription Detection

The detector identifies likely subscriptions based on:
- **Known services**: Netflix, Spotify, Amazon Prime, Disney+, HBO, Hulu, Apple, Google, Microsoft, Adobe, etc.
- **Keywords**: subscription, membership, premium, monthly, annual
- **Amount stability**: Fixed or near-fixed amounts with low variance

### Confidence Scoring

Pattern confidence is calculated from:
- **Occurrence count**: More occurrences = higher confidence
- **Interval regularity**: Lower standard deviation = higher confidence
- **Amount consistency**: Fixed amounts boost confidence
- **Frequency type**: Regular frequencies (weekly, monthly) score higher than irregular

### Programmatic Usage

```typescript
import { detectRecurring, detectRecurringFromStatements } from 'boa-statement-parser';

// From raw transactions
const result = detectRecurring(transactions, {
  minOccurrences: 3,        // Minimum occurrences to detect pattern (default: 2)
  maxIntervalVariance: 0.4, // Maximum coefficient of variation (default: 0.4)
});

// From parsed statements
const result = detectRecurringFromStatements(statements);

console.log(result.summary.estimatedMonthlyRecurring);
console.log(result.patterns.filter(p => p.isSubscription));
```

## Supabase Database Integration

The parser includes optional integration with Supabase for persistent storage of parsed statements and transactions.

### Features

- **Deterministic deduplication**: Uses `statementId` and `transactionId` to prevent duplicates on re-import
- **Normalized schema**: Separate tables for accounts, statements, and transactions
- **Analytics views**: Pre-built views for monthly spending, merchant analysis, and account summaries
- **Human corrections**: Override system for category corrections without mutating raw data
- **Row Level Security**: Multi-tenant isolation via Supabase RLS policies

### Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com)

2. **Run the schema migrations** in the Supabase SQL Editor:

```sql
-- Run these files in order from .windsurf/skills/supabase-bank-ledger-schema/references/
-- 1. schema.sql - Creates tables and indexes
-- 2. rls-policies.sql - Enables row-level security
-- 3. views.sql - Creates analytics views
```

3. **Configure environment variables**:

```bash
# .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
BOA_USER_ID=your-user-uuid
```

### CLI Usage

```bash
# Parse and upload to Supabase
pnpm parse-boa --inputDir ./statements --upload --user-id "your-user-uuid"

# With explicit Supabase credentials
pnpm parse-boa --inputDir ./statements --upload \
  --supabase-url "https://your-project.supabase.co" \
  --supabase-key "your-anon-key" \
  --user-id "your-user-uuid"

# Combine with other options
pnpm parse-boa --inputDir ./statements --upload --user-id "your-uuid" \
  --out result.json --verbose
```

### Programmatic Usage

```typescript
import {
  createSupabaseClient,
  importV2Result,
  getTransactions,
  getMonthlyCategoryTotals,
  setTransactionOverride,
} from 'boa-statement-parser';

// Create client
const client = createSupabaseClient({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
});

// Import parsed results
const importResult = await importV2Result(client, userId, {
  result: v2Output,
});
console.log(`Inserted ${importResult.transactionsInserted} transactions`);

// Query transactions
const transactions = await getTransactions(client, userId, {
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  category: 'Food & Dining',
});

// Get monthly spending by category
const monthlyTotals = await getMonthlyCategoryTotals(client, userId);

// Override a transaction's category
await setTransactionOverride(client, userId, {
  transactionDbId: 'uuid-of-transaction',
  category: 'Entertainment',
  subcategory: 'Streaming',
  source: 'human',
  notes: 'Corrected from Food & Dining',
});
```

### Database Schema

| Table | Description |
|-------|-------------|
| `sources` | Uploaded PDF files with SHA-256 deduplication |
| `parse_runs` | Parser execution records with JSONB snapshots |
| `accounts` | Normalized account identity |
| `statements` | Statement periods and balances |
| `transactions` | Canonical transaction fact table |
| `transaction_overrides` | Human/ML category corrections |

### Analytics Views

| View | Description |
|------|-------------|
| `account_summary` | Account overview with latest balance |
| `monthly_category_totals` | Monthly spending by category |
| `merchant_spending` | Top merchants by total spent |
| `daily_balance` | Running balance per account |
| `transactions_needing_review` | Uncategorized or low-confidence transactions |
| `transactions_effective` | Transactions with overrides applied |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional service role key for server-side operations |
| `BOA_USER_ID` | Default user ID for CLI uploads |
| `BOA_UPLOAD` | Enable upload by default (`true`/`false`) |

## CLI Options

| Option | Description |
|--------|-------------|
| `-d, --inputDir <dir>` | Directory containing PDF files to batch process |
| `-o, --out <file>` | Output file path (default: stdout) |
| `-f, --format <format>` | Output format: `json` or `ofx` (default: json) |
| `--split-accounts` | Split OFX into separate files per account |
| `-v, --verbose` | Enable verbose output with debug info |
| `-s, --strict` | Enable strict validation mode |
| `--pretty` | Pretty-print JSON output (default: true) |
| `--no-pretty` | Disable pretty-printing |
| `--single` | Parse as single statement (legacy mode) |
| `--schema-version <v1\|v2>` | Output schema version (default: v1) |
| `--train-ml` | Train ML categorizer from parsed transactions |
| `--ml` | Use ML-based categorization (hybrid mode) |
| `--model <path>` | Path to ML model directory (for loading) |
| `--model-out <path>` | Output path for trained ML model |
| `--epochs <number>` | Number of training epochs (default: 50) |
| `--detect-recurring` | Detect recurring transactions and include in output |
| `--upload` | Upload parsed results to Supabase database |
| `--supabase-url <url>` | Supabase project URL (or use `SUPABASE_URL` env var) |
| `--supabase-key <key>` | Supabase anon/service role key (or use `SUPABASE_ANON_KEY` env var) |
| `--user-id <id>` | User ID for Supabase RLS (required for `--upload`) |
| `--version` | Show version number |
| `--help` | Show help |

### Init Command

| Option | Description |
|--------|-------------|
| `init` | Initialize project with .env file and ML model |
| `init --force` | Overwrite existing files |
| `init --no-model` | Skip copying ML model files |

## Output Schema Versioning

The parser supports multiple output schema versions for backwards compatibility and new features.

### Selecting Schema Version

Schema version is resolved with the following precedence (highest to lowest):

1. **CLI flag**: `--schema-version v1` or `--schema-version v2`
2. **Environment variable**: `FINAL_RESULT_SCHEMA_VERSION=v2`
3. **Default**: `v1`

### Schema v1 (Default)

The original output format with a flat array of statements:

```json
{
  "schemaVersion": "v1",
  "statements": [
    {
      "account": { "institution": "Bank of America", "accountType": "checking", ... },
      "summary": { "startingBalance": 100, "endingBalance": 200, ... },
      "transactions": [...],
      "metadata": { "parserVersion": "1.0.0", "parsedAt": "...", "warnings": [] }
    }
  ],
  "totalStatements": 1,
  "totalTransactions": 5
}
```

### Schema v2 (BOFA Rollup)

A new rollup format that groups transactions by account with aggregated totals, analytics, and integrity checks:

```json
{
  "schemaVersion": "v2",
  "startingBalance": 100,
  "endingBalance": 500,
  "totalStatements": 3,
  "totalTransactions": 50,
  "analytics": {
    "quarterlyCashFlow": [...],
    "incomeVsExpenses": { "totalIncome": 5000, "totalExpenses": 4500, "netIncome": 500, ... },
    "lenderSummary": { "averageMonthlyIncome": 2500, "incomeStabilityScore": 85, ... },
    "taxPreparation": { "taxYear": 2025, "totalTaxableIncome": 30000, ... }
  },
  "integrity": {
    "overallValid": true,
    "statementsChecked": 3,
    "statementsWithIssues": 0,
    "statementResults": [...],
    "summary": { "totalDiscrepancies": 0, "totalDelta": 0, "warnings": [] }
  },
  "accounts": [
    {
      "account": { "institution": "Bank of America", "accountType": "checking", ... },
      "summary": { "startingBalance": 100, "endingBalance": 300, ... },
      "transactions": [
        {
          "date": "2025-01-15",
          "description": "PAYROLL DIRECT DEP",
          "amount": 2500,
          "category": "Income",
          "subcategory": "Salary",
          "confidence": 0.95,
          "statementId": "CHECKING-1234-20250101-20250131",
          "periodLabel": "2025-01 BOA Checking",
          ...
        }
      ],
      "totalStatements": 2,
      "totalTransactions": 30
    }
  ]
}
```

### Key Differences: v1 vs v2

| Feature | v1 | v2 |
|---------|----|----|
| Structure | Flat statements array | Grouped by account |
| Root balances | Not included | Rolled up across accounts |
| Per-account totals | Not included | `totalStatements`, `totalTransactions` |
| Analytics | Not included | Quarterly cash flow, income vs expenses, lender summary, tax prep |
| Integrity checks | Not included | Per-statement balance validation with discrepancy reporting |
| Transaction traceability | Not included | `statementId`, `periodLabel` on each transaction |
| Metadata | Per-statement | Not included (simpler) |
| Use case | Individual statement processing | Multi-account rollup/reporting/analytics |

### Migration from v1 to v2

If you're consuming v1 output and want to migrate to v2:

1. Update your code to handle the `accounts` array instead of `statements`
2. Access transactions via `accounts[n].transactions` instead of `statements[n].transactions`
3. Use root-level `startingBalance`/`endingBalance` for overall totals
4. Note that v2 groups multiple statements for the same account into one account block

### Version Lifecycle

Future schema versions will follow this pattern:

1. New versions are added as `v3`, `v4`, etc.
2. Existing versions remain available indefinitely
3. Default version changes only in major releases
4. Deprecation warnings will be added before removal

### Confidence Semantics

The `confidence` field in transactions represents **parsing/OCR confidence**, not financial correctness:

| Value | Meaning |
|-------|---------|
| 0.95 (HIGH) | Exact pattern match with high certainty |
| 0.85 (MEDIUM_HIGH) | Strong keyword match |
| 0.75 (MEDIUM) | Partial or weaker pattern match |
| 0.50 (LOW) | Uncategorized or uncertain extraction |

**Important distinctions:**
- **Confidence ≠ Financial Accuracy**: A transaction with 0.95 confidence means the parser is confident about the extraction, not that the amount is financially verified
- **Low confidence flags**: Values < 0.75 indicate the parser had difficulty extracting or categorizing the transaction
- **OCR artifacts**: Low confidence may indicate OCR issues in the source PDF
- **Review recommendation**: Transactions with confidence < 0.75 should be manually reviewed

### Example Commands

```bash
# Use v1 (default)
pnpm parse-boa ./statement.pdf

# Explicitly use v1
pnpm parse-boa ./statement.pdf --schema-version v1

# Use v2 rollup format
pnpm parse-boa ./statement.pdf --schema-version v2

# Use environment variable
FINAL_RESULT_SCHEMA_VERSION=v2 pnpm parse-boa ./statement.pdf
```

## Environment Variables

The parser automatically loads environment variables from a `.env` file using [dotenv](https://www.npmjs.com/package/dotenv). This eliminates the need to set environment variables manually in your shell.

### Quick Setup

```bash
# Copy the example file
cp .env.example .env

# Edit as needed
nano .env  # or use your preferred editor
```

The `.env` file is automatically loaded when running the CLI. No additional configuration required.

### Application Settings

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `FINAL_RESULT_SCHEMA_VERSION` | `v1`, `v2` | `v2` | Controls the output JSON schema format |

**`FINAL_RESULT_SCHEMA_VERSION`**

Determines which output schema version to use when generating JSON output. This is the primary application-specific environment variable.

- **`v1`**: Original flat format with a `statements` array. Best for individual statement processing.
- **`v2`**: Rollup format grouped by account with analytics, integrity checks, and aggregated totals. Best for multi-account reporting and financial analysis.

Resolution precedence (highest to lowest):
1. CLI flag: `--schema-version v2`
2. `.env` file: `FINAL_RESULT_SCHEMA_VERSION=v2`
3. Default: `v2`

```bash
# Simply run the CLI - .env is loaded automatically
pnpm parse-boa ./statement.pdf

# CLI flags still override .env values
pnpm parse-boa ./statement.pdf --schema-version v1
```

### Input/Output Settings

| Variable | CLI Equivalent | Default | Description |
|----------|----------------|---------|-------------|
| `BOA_INPUT_DIR` | `--inputDir` | (none) | Directory containing PDF files to process |
| `BOA_OUTPUT_FILE` | `--out` | stdout | Output file path |
| `BOA_FORMAT` | `--format` | `json` | Output format: `json`, `ofx`, `csv` |
| `BOA_SPLIT_ACCOUNTS` | `--split-accounts` | `false` | Split output into separate files per account |

**Example:**
```bash
# .env
BOA_INPUT_DIR=C:\Users\YourName\Documents\Statements
BOA_OUTPUT_FILE=result.json
BOA_FORMAT=json
```

Now you can simply run:
```bash
pnpm parse-boa
```

### Parsing Options

| Variable | CLI Equivalent | Default | Description |
|----------|----------------|---------|-------------|
| `BOA_VERBOSE` | `--verbose` | `false` | Enable verbose output with debug info |
| `BOA_STRICT` | `--strict` | `false` | Enable strict validation mode |
| `BOA_PRETTY` | `--pretty` | `true` | Pretty-print JSON output |
| `BOA_SINGLE` | `--single` | `false` | Parse as single statement (legacy mode) |
| `BOA_DETECT_RECURRING` | `--detect-recurring` | `false` | Detect recurring transactions |

### ML Categorization Settings

| Variable | CLI Equivalent | Default | Description |
|----------|----------------|---------|-------------|
| `BOA_ML` | `--ml` | `false` | Use ML-based categorization (hybrid mode) |
| `BOA_MODEL_PATH` | `--model` | (none) | Path to ML model directory for loading |
| `BOA_MODEL_OUT` | `--model-out` | (none) | Output path for trained ML model |
| `BOA_TRAIN_ML` | `--train-ml` | `false` | Train ML categorizer from parsed transactions |
| `BOA_EPOCHS` | `--epochs` | `50` | Number of training epochs |

**Example ML configuration:**
```bash
# .env
BOA_ML=true
BOA_MODEL_PATH=./models/categorizer
```

### Node.js Runtime

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `NODE_ENV` | `development`, `production`, `test` | `development` | Node.js environment mode |

**`NODE_ENV`**

Standard Node.js environment variable that affects runtime behavior:

- **`development`**: Enables verbose error messages, development-only features
- **`production`**: Optimizes for performance, minimizes logging
- **`test`**: Used during test execution (set automatically by Vitest)

```bash
# Production mode
NODE_ENV=production pnpm parse-boa ./statement.pdf
```

### TensorFlow.js Settings

These variables control the ML categorizer's TensorFlow.js backend behavior.

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `TF_FORCE_BACKEND` | `cpu`, `webgl`, `wasm` | `cpu` | Force a specific TensorFlow.js backend |
| `TF_CPP_MIN_LOG_LEVEL` | `0`, `1`, `2`, `3` | `0` | TensorFlow C++ logging level |
| `TF_ENABLE_ONEDNN_OPTS` | `0`, `1` | `1` | Enable/disable oneDNN optimizations |

**`TF_FORCE_BACKEND`**

Forces TensorFlow.js to use a specific computation backend:

- **`cpu`**: Pure JavaScript CPU backend. Most compatible, works everywhere.
- **`webgl`**: GPU-accelerated via WebGL. Faster for large models but requires GPU.
- **`wasm`**: WebAssembly backend. Good balance of speed and compatibility.

```bash
# Force CPU backend (recommended for Node.js)
TF_FORCE_BACKEND=cpu pnpm parse-boa --ml ./statement.pdf
```

**`TF_CPP_MIN_LOG_LEVEL`**

Controls TensorFlow's C++ logging verbosity (when using native bindings):

- **`0`**: All logs (DEBUG, INFO, WARNING, ERROR)
- **`1`**: INFO and above
- **`2`**: WARNING and above (suppresses most logs)
- **`3`**: ERROR only

```bash
# Suppress TensorFlow info/warning logs
TF_CPP_MIN_LOG_LEVEL=2 pnpm parse-boa --train-ml --inputDir ./statements
```

**`TF_ENABLE_ONEDNN_OPTS`**

Controls Intel oneDNN (formerly MKL-DNN) optimizations:

- **`1`**: Enable oneDNN optimizations (faster on Intel CPUs)
- **`0`**: Disable oneDNN (useful if experiencing compatibility issues)

```bash
# Disable oneDNN if seeing warnings
TF_ENABLE_ONEDNN_OPTS=0 pnpm parse-boa --ml ./statement.pdf
```

### Debugging

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `DEBUG` | Pattern string | (none) | Enable debug output for specific modules |
| `NO_COLOR` | `1` | (none) | Disable colors in console output |
| `FORCE_COLOR` | `1` | (none) | Force colors in console output |

**`DEBUG`**

Enables debug logging for specific modules using the `debug` package pattern:

```bash
# Enable all boa-parser debug logs
DEBUG=boa-parser:* pnpm parse-boa ./statement.pdf

# Enable specific module debugging
DEBUG=boa-parser:extractor pnpm parse-boa ./statement.pdf

# Multiple patterns
DEBUG=boa-parser:parser,boa-parser:categorizer pnpm parse-boa ./statement.pdf
```

**`NO_COLOR`**

Disables ANSI color codes in console output. Useful for logging to files or CI environments:

```bash
# Disable colors
NO_COLOR=1 pnpm parse-boa ./statement.pdf > output.log
```

**`FORCE_COLOR`**

Forces ANSI color codes even when output is not a TTY. Overrides `NO_COLOR`:

```bash
# Force colors in piped output
FORCE_COLOR=1 pnpm parse-boa ./statement.pdf | tee output.log
```

### Example .env File

```bash
# .env - Complete example with all CLI options configured

# Input/Output
BOA_INPUT_DIR=C:\Users\YourName\Documents\Statements
BOA_OUTPUT_FILE=result.json
BOA_FORMAT=json

# Parsing
FINAL_RESULT_SCHEMA_VERSION=v2
BOA_VERBOSE=false
BOA_STRICT=false

# ML Categorization
BOA_ML=true
BOA_MODEL_PATH=./models/categorizer

# Runtime
NODE_ENV=production
TF_CPP_MIN_LOG_LEVEL=2
TF_ENABLE_ONEDNN_OPTS=0
```

With this configuration, you can run:
```bash
pnpm parse-boa
```
Instead of:
```bash
pnpm parse-boa --inputDir "C:\Users\YourName\Documents\Statements" --ml --model ./models/categorizer --schema-version v2 --out result.json
```

### CI/CD Environment

In CI/CD pipelines (GitHub Actions, etc.), you can set environment variables in your workflow:

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      NODE_ENV: test
      FINAL_RESULT_SCHEMA_VERSION: v2
      TF_CPP_MIN_LOG_LEVEL: 2
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```

## CSV Export

The parser supports exporting to CSV format for spreadsheet import (Excel, Google Sheets, etc.).

### CLI Usage

```bash
# Export single PDF to CSV
pnpm parse-boa ./statement.pdf --format csv --out statement.csv

# Export directory of PDFs to CSV
pnpm parse-boa --inputDir ./statements --format csv --out combined.csv

# Split into separate files per account (boa_checking_3529.csv, boa_savings_4971.csv)
pnpm parse-boa --inputDir ./statements --format csv --split-accounts --out ./output/
```

### CSV Columns

| Column | Description |
|--------|-------------|
| `Date` | Transaction date (ISO format) |
| `Posted Date` | Posted date if available |
| `Description` | Cleaned transaction description |
| `Merchant` | Extracted merchant name |
| `Amount` | Signed amount (negative for debits) |
| `Direction` | `credit` or `debit` |
| `Type` | Transaction type (Purchase, Deposit, Transfer, etc.) |
| `Account Type` | `checking`, `credit`, `savings` |
| `Account Number` | Masked account number |
| `Category` | Assigned category |
| `Subcategory` | Assigned subcategory |
| `Confidence` | Categorization confidence score |

### Programmatic Usage

```typescript
import { toFinalResultV2, exportCsv, exportCsvByAccount } from 'boa-statement-parser';

// Convert to v2 format
const v2Result = toFinalResultV2(canonicalOutput);

// Export to CSV
const csvText = exportCsv(v2Result);

// Or export per account
const splitResults = exportCsvByAccount(v2Result);
for (const { filename, content } of splitResults) {
  fs.writeFileSync(filename, content);
}
```

## OFX Export

The parser supports exporting to OFX (Open Financial Exchange) format for import into accounting software like Quicken, GnuCash, or Dolibarr.

### CLI Usage

```bash
# Export single PDF to OFX
pnpm parse-boa ./statement.pdf --format ofx --out statement.ofx

# Export directory of PDFs to OFX
pnpm parse-boa --inputDir ./statements --format ofx --out combined.ofx

# Split into separate files per account (boa_checking_3529.ofx, boa_savings_4971.ofx)
pnpm parse-boa --inputDir ./statements --format ofx --split-accounts --out ./output/

# With verbose output
pnpm parse-boa ./statement.pdf --format ofx --out statement.ofx --verbose
```

### OFX Transaction Types

The exporter automatically detects specific OFX transaction types from descriptions:

| Type | Detected From |
|------|---------------|
| `DEP` | Deposit, Direct Dep, Payroll |
| `POS` | Checkcard, Purchase, Debit Card |
| `ATM` | ATM, Cash Withdrawal |
| `XFER` | Zelle, Transfer, Wire |
| `CHECK` | Check #1234 (also extracts `CHECKNUM`) |
| `FEE` | Fee, Service Charge, Overdraft |
| `PAYMENT` | Payment, Bill Pay, ACH |
| `INT` | Interest |

### Programmatic Usage

```typescript
import { toFinalResultV2, exportOfx } from 'boa-statement-parser';

// Convert to v2 format
const v2Result = toFinalResultV2(canonicalOutput);

// Export to OFX
const ofxText = exportOfx(v2Result);

// Or export a single account
import { exportAccountOfx } from 'boa-statement-parser';
const singleAccountOfx = exportAccountOfx(v2Result.accounts[0]);
```

### OFX Features

- **FITID**: Uses deterministic `transactionId` as OFX FITID for reliable duplicate detection
- **Signed amounts**: Credits are positive, debits are negative
- **Date formatting**: Converts ISO dates to OFX YYYYMMDD format
- **Multiple accounts**: Generates one `<STMTTRNRS>` block per account
- **Ledger balance**: Includes ending balance with date

### Schema Versioning Notes

- **v1 stays canonical raw output**: The v1 schema represents the raw parsed output from individual statements
- **v2 is rollup + integrity**: The v2 schema groups by account and adds analytics/integrity checks
- **schemaVersion remains v1/v2**: The `schemaVersion` field is a const and should not be changed
- **schemaRevision is optional**: Use the new optional `schemaRevision` field for minor version tracking without breaking validation

## Deduplication

When processing multiple PDFs (especially when combined PDFs overlap with individual statement PDFs), the parser performs intelligent deduplication:

### Statement-Level Deduplication

**Identity Key**: `{accountNumberMasked}|{periodStart}|{periodEnd}`

When duplicate statements are found, the parser keeps the "best" one using these tie-break rules:

1. **Completeness score** - Higher wins (based on transaction count, valid totals, fewer warnings)
2. **Standalone over combined** - Prefers individual PDFs over combined PDFs (less merge artifacts)
3. **Lexicographic filename** - Deterministic final tie-breaker

### Transaction-Level Deduplication

**Identity Key**: `{date}|{amount}|{direction}|{normalized_description}`

Transactions are deduped within each statement, keeping the one with higher confidence score.

### Example Output Summary

```
=== Batch Processing Summary ===
Total PDFs found:       11
PDFs succeeded:         11
PDFs failed:            0
Statements before dedup: 11
Statements kept:        11
Statements deduped:     0
Transactions merged:    424
Transactions deduped:   1
================================
```

## Development

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage report
```

### Lint

```bash
pnpm lint           # Check for issues
pnpm lint:fix       # Auto-fix issues
pnpm format         # Format with Prettier
```

## Project Structure

```
/src
  /cli                # Command-line interface
  /batch              # Batch processing orchestration
    batch-processor.ts    # Multi-PDF processing with dedup
  /parsers            # Bank-specific parsers
    /boa              # Bank of America parsers
      checking-parser.ts    # Checking account parsing
      savings-parser.ts     # Savings account parsing
      credit-parser.ts      # Credit card parsing
      transaction-details-parser.ts # "Print Transaction Details" PDF parsing
      channel-extractor.ts  # Channel type & bank reference extraction
      merchant-extractor.ts # Merchant info extraction
      line-merger.ts        # Wrapped line handling
      transaction-normalizer.ts # Full transaction normalization
  /extractors         # PDF extraction utilities
  /normalizers        # Data transformation utilities
  /categorization     # Transaction categorization
    categories.ts         # Legacy category rules
    categorizer.ts        # Legacy categorizer
    categorizer-v2.ts     # Priority-based categorizer with confidence tiers
    ml-categorizer.ts     # TensorFlow.js ML-based categorizer
    hybrid-categorizer.ts # Combined rule + ML categorization
    training-data-generator.ts # Synthetic training data generation
  /schemas            # Zod schemas and types
  /types              # TypeScript output types (aligned with JSON Schema)
  /validation         # AJV JSON Schema validation
  /utils              # Shared utilities
    directory-scanner.ts  # PDF file discovery and filtering
    statement-merger.ts   # Statement/transaction deduplication
/tests                # Test files (367+ tests)
/.windsurf            # Agent documentation
```

## Extending to Other Banks

The architecture supports adding parsers for other banks:

1. Create a new directory: `src/parsers/<bank>/`
2. Implement detection patterns for the bank's format
3. Create account-type-specific parsers
4. Add categorization rules for bank-specific descriptions
5. Register the parser in the main index

Example structure for a new bank:

```
/src/parsers/chase/
  index.ts           # Main parser and detection
  checking-parser.ts # Checking account logic
  credit-parser.ts   # Credit card logic
  types.ts           # Internal types
```

## Library Choices

| Library | Purpose | Rationale |
|---------|---------|-----------|
| `pdfjs-dist` | Layout-aware PDF extraction | Positional text extraction for reliable table parsing |
| `pdf-parse` | Fallback PDF extraction | Lightweight, no native deps, good for simple text |
| `zod` | Schema validation | Runtime validation, TypeScript inference, composable |
| `ajv` | JSON Schema validation | Draft 2020-12 support, fast, comprehensive |
| `commander` | CLI parsing | Industry standard, auto-help, type-safe |
| `vitest` | Testing | Fast, ESM-native, Jest-compatible API |

## Parsing Engine Upgrade

### Layout-Aware Extraction (pdfjs-dist)

The parser now includes a layout-aware extraction engine using `pdfjs-dist` that extracts text with positional coordinates (x, y, width, height). This enables reliable row/column reconstruction for table parsing.

**Key advantages:**
- **Positional data**: Each text item includes x/y coordinates for accurate row grouping
- **Column detection**: Infers column boundaries from header rows or X-coordinate clustering
- **Wrapped line handling**: Merges multi-line descriptions that span multiple PDF text items
- **Resilience**: More robust to minor formatting changes across statement versions

**When to use each extractor:**
- **pdfjs-dist (default)**: Best for structured table data, transaction parsing
- **pdf-parse (fallback)**: Simpler extraction when layout isn't critical

### Row/Column Reconstruction

The layout engine provides utilities for:

```typescript
import { extractTextItems } from 'boa-statement-parser';
import { groupByRows, mergeWrappedDescriptions } from 'boa-statement-parser/layout';

// Extract with positions
const { items } = await extractTextItems('./statement.pdf');

// Group into rows (yTolerance default: 3.0)
const rows = groupByRows(items, 3.0);

// Merge wrapped descriptions
const merged = mergeWrappedDescriptions(rows);
```

### Balance Reconciliation

Quality checks validate that parsed data is consistent:

```typescript
import { validateReconciliation } from 'boa-statement-parser/validation';

const result = validateReconciliation(
  startingBalance,
  endingBalance,
  totalCredits,
  totalDebits,
  { tolerance: 0.01 }
);

if (!result.passed) {
  console.warn(`Balance mismatch: ${result.difference}`);
}
```

### Future Extensions

- **MuPDF adapter**: Optional high-fidelity extraction (not yet implemented)
- **OCR pathway**: For scanned/image-based PDFs (extension point documented)

## Known Limitations

- Scanned/image-based PDFs are not supported (OCR required)
- Some complex table layouts may not parse correctly
- Statement formats may vary; parser tuned for recent formats
- International/non-USD statements not supported
- Password-protected PDFs will fail with an error (captured in `parseErrors`)

## Troubleshooting

### "Could not determine account type"

The parser couldn't identify whether the statement is checking or credit. This usually means:
- The PDF text extraction failed
- The statement format is significantly different from expected

Try running with `--verbose` to see extracted text.

### "No transactions found"

The transaction section patterns didn't match. Possible causes:
- Statement has no transactions
- Format differs from expected patterns
- PDF text extraction issues

### Balance Mismatch Warning

In strict mode, the parser verifies that:
```
starting_balance + credits - debits = ending_balance
```

A mismatch may indicate:
- Missing transactions
- Parsing errors
- Fees/interest not captured

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `pnpm lint && pnpm test`
5. Submit a pull request
