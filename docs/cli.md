# CLI Reference

The `parse-boa` CLI provides a full-featured command-line interface for parsing Bank of America PDF statements.

## Initialization

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

## Basic Usage

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

## Batch Directory Processing

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

## Output Format Options

```bash
# JSON output (default)
pnpm parse-boa ./statement.pdf --out result.json

# OFX output for accounting software
pnpm parse-boa ./statement.pdf --format ofx --out statement.ofx

# CSV output for spreadsheets
pnpm parse-boa ./statement.pdf --format csv --out statement.csv

# Split into separate files per account
pnpm parse-boa --inputDir ./statements --format csv --split-accounts --out ./output/
```

See [Export Formats](./export-formats.md) for details on CSV and OFX output.

## Schema Version Selection

```bash
# Use v2 rollup format (default)
pnpm parse-boa ./statement.pdf

# Explicitly use v1 flat format
pnpm parse-boa ./statement.pdf --schema-version v1

# Explicitly use v2
pnpm parse-boa ./statement.pdf --schema-version v2

# Use environment variable
FINAL_RESULT_SCHEMA_VERSION=v2 pnpm parse-boa ./statement.pdf
```

See [Output Schema](./output-schema.md) for schema version details.

## ML Training

```bash
# Train ML model using synthetic data only
pnpm parse-boa --train-ml --model-out ./models/categorizer

# Train ML model from your parsed statements (recommended)
pnpm parse-boa --train-ml --inputDir ./statements --model-out ./models/categorizer

# Train with more epochs for better accuracy
pnpm parse-boa --train-ml --inputDir ./statements --model-out ./models/categorizer --epochs 100 --verbose
```

See [Categorization](./categorization.md) for ML details.

## Recurring Transaction Detection

```bash
# Detect recurring transactions
pnpm parse-boa --inputDir ./statements --detect-recurring --out result.json

# With verbose output showing detection stats
pnpm parse-boa --inputDir ./statements --detect-recurring --verbose --out result.json
```

See [Recurring Transactions](./recurring-transactions.md) for details.

## Supabase Upload

```bash
# Parse and upload to Supabase
pnpm parse-boa --inputDir ./statements --upload --user-id "your-user-uuid"

# With explicit Supabase credentials
pnpm parse-boa --inputDir ./statements --upload \
  --supabase-url "https://your-project.supabase.co" \
  --supabase-key "your-anon-key" \
  --user-id "your-user-uuid"
```

See [Supabase Integration](./supabase.md) for setup and details.

## Plaid Commands

```bash
# Test Plaid connection
pnpm parse-boa plaid test

# Link a new bank account
pnpm parse-boa plaid link --user-id "your-user-uuid"

# List linked accounts
pnpm parse-boa plaid list

# Sync transactions
pnpm parse-boa plaid sync --item-id <id>

# Sync all linked items
pnpm parse-boa plaid sync-all --user-id "your-user-uuid"

# Reconcile PDF vs Plaid transactions (monthly statement)
pnpm parse-boa plaid reconcile --item-id <id> ./statement.pdf

# Reconcile "Print Transaction Details" PDF from online banking
pnpm parse-boa plaid reconcile --item-id <id> ./transaction-details.pdf

# Reconcile from pre-parsed JSON result
pnpm parse-boa plaid reconcile --item-id <id> ./result.json
```

See [Plaid Integration](./plaid.md) for full command reference.

## All CLI Options

| Option | Description |
|--------|-------------|
| `-d, --inputDir <dir>` | Directory containing PDF files to batch process |
| `-o, --out <file>` | Output file path (default: stdout) |
| `-f, --format <format>` | Output format: `json`, `ofx`, or `csv` (default: json) |
| `--split-accounts` | Split output into separate files per account |
| `-v, --verbose` | Enable verbose output with debug info |
| `-s, --strict` | Enable strict validation mode |
| `--pretty` | Pretty-print JSON output (default: true) |
| `--no-pretty` | Disable pretty-printing |
| `--single` | Parse as single statement (legacy mode) |
| `--schema-version <v1\|v2>` | Output schema version (default: v2) |
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

### Init Command Options

| Option | Description |
|--------|-------------|
| `init` | Initialize project with .env file and ML model |
| `init --force` | Overwrite existing files |
| `init --no-model` | Skip copying ML model files |
