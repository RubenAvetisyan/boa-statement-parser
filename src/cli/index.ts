#!/usr/bin/env node
/* eslint-disable no-console */

// Load environment variables from .env file
import 'dotenv/config';

import { Command } from 'commander';
import { writeFile, mkdir, copyFile, access, constants } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractPDF } from '../extractors/index.js';
import { parseBoaStatement, parseBoaMultipleStatements } from '../parsers/index.js';
import { ParsedStatementSchema } from '../schemas/index.js';
import {
  resolveSchemaVersion,
  validateOutputOrThrow,
  AVAILABLE_SCHEMA_VERSIONS,
} from '../schemas/schema-registry.js';
import { toFinalResult, toFinalResultV2, exportOfx, exportOfxByAccount, exportCsv, exportCsvByAccount, detectRecurringFromStatements, type CanonicalOutput } from '../output/index.js';

const AVAILABLE_FORMATS = ['json', 'ofx', 'csv'] as const;
type OutputFormat = typeof AVAILABLE_FORMATS[number];
import { PARSER_VERSION } from '../utils/constants.js';
import { scanDirectoryForPdfs, validateDirectory } from '../utils/directory-scanner.js';
import { processBatch, type ParseError } from '../batch/index.js';
import {
  createSupabaseClient,
  importV2Result,
  importParseRun,
  needsMigration,
  getMigrationSQL,
  runAutoMigration,
} from '../supabase/index.js';
import { HybridCategorizer, generateTrainingData, generateFromParsedTransactions } from '../categorization/index.js';
import type { TrainingExample } from '../categorization/index.js';

const program = new Command();

// Helper to parse boolean env vars
const envBool = (key: string, defaultVal: boolean): boolean => {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultVal;
  return val === 'true' || val === '1';
};

// Single PDF command (default)
program
  .name('parse-boa')
  .description('Parse Bank of America statement PDFs into structured JSON')
  .version(PARSER_VERSION)
  .argument('[pdf-file]', 'Path to the Bank of America statement PDF')
  .option('-d, --inputDir <directory>', 'Directory containing multiple PDF files to process', process.env['BOA_INPUT_DIR'])
  .option('-o, --out <file>', 'Output file path (default: stdout)', process.env['BOA_OUTPUT_FILE'])
  .option('-v, --verbose', 'Enable verbose output', envBool('BOA_VERBOSE', false))
  .option('-s, --strict', 'Enable strict validation mode', envBool('BOA_STRICT', false))
  .option('--pretty', 'Pretty-print JSON output', envBool('BOA_PRETTY', true))
  .option('--no-pretty', 'Disable pretty-printing')
  .option('--single', 'Parse as single statement (legacy mode)', envBool('BOA_SINGLE', false))
  .option(
    '--schema-version <version>',
    `Output schema version (${AVAILABLE_SCHEMA_VERSIONS.join(', ')})`,
    process.env['FINAL_RESULT_SCHEMA_VERSION']
  )
  .option(
    '-f, --format <format>',
    `Output format (${AVAILABLE_FORMATS.join(', ')})`,
    process.env['BOA_FORMAT'] ?? 'json'
  )
  .option(
    '--split-accounts',
    'Split output into separate files per account (only with --format ofx or csv)',
    envBool('BOA_SPLIT_ACCOUNTS', false)
  )
  .option('--train-ml', 'Train ML categorizer from parsed transactions', envBool('BOA_TRAIN_ML', false))
  .option('--ml', 'Use ML-based categorization (hybrid mode)', envBool('BOA_ML', false))
  .option('--model <path>', 'Path to ML model directory (for loading or saving)', process.env['BOA_MODEL_PATH'] ?? (envBool('BOA_ML', false) ? './models/categorizer' : undefined))
  .option('--model-out <path>', 'Output path for trained ML model', process.env['BOA_MODEL_OUT'])
  .option('--epochs <number>', 'Number of training epochs', process.env['BOA_EPOCHS'] ?? '50')
  .option('--detect-recurring', 'Detect recurring transactions and include in output', envBool('BOA_DETECT_RECURRING', false))
  .option('--upload', 'Upload parsed results to Supabase database', envBool('BOA_UPLOAD', false))
  .option('--supabase-url <url>', 'Supabase project URL', process.env['SUPABASE_URL'])
  .option('--supabase-key <key>', 'Supabase anon or service role key', process.env['SUPABASE_ANON_KEY'])
  .option('--user-id <id>', 'User ID for Supabase RLS (required for --upload)', process.env['BOA_USER_ID'])
  .action(async (pdfFile: string | undefined, options: {
    inputDir?: string;
    out?: string;
    verbose: boolean;
    strict: boolean;
    pretty: boolean;
    single: boolean;
    schemaVersion?: string;
    format: string;
    splitAccounts: boolean;
    trainMl: boolean;
    ml: boolean;
    model?: string;
    modelOut?: string;
    epochs: string;
    detectRecurring: boolean;
    upload: boolean;
    supabaseUrl?: string;
    supabaseKey?: string;
    userId?: string;
  }) => {
    try {
      // ML Training mode
      if (options.trainMl) {
        await trainMLModel(options);
        return;
      }

      // Determine mode: directory or single file
      if (options.inputDir !== undefined) {
        // Directory batch mode
        await processDirectory(options.inputDir, options);
      } else if (pdfFile !== undefined) {
        // Single file mode
        await processSingleFile(pdfFile, options);
      } else {
        console.error('[ERROR] Either a PDF file or --inputDir must be specified');
        process.exit(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ERROR] ${message}`);
      if (options.verbose && error instanceof Error && error.stack !== undefined) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Migrate subcommand
program
  .command('migrate')
  .description('Generate or check Supabase database migrations')
  .option('--print', 'Print the full migration SQL to stdout')
  .option('--check', 'Check if migrations are needed')
  .option('--auto', 'Automatically run migrations (requires SUPABASE_DB_PASSWORD)')
  .option('--no-rls', 'Exclude RLS policies from output')
  .option('--no-views', 'Exclude views from output')
  .option('--supabase-url <url>', 'Supabase project URL', process.env['SUPABASE_URL'])
  .option('--supabase-key <key>', 'Supabase anon or service role key', process.env['SUPABASE_ANON_KEY'])
  .option('--db-password <password>', 'Database password for auto-migration', process.env['SUPABASE_DB_PASSWORD'])
  .option('-v, --verbose', 'Verbose output')
  .action(async (options: {
    print?: boolean;
    check?: boolean;
    auto?: boolean;
    rls: boolean;
    views: boolean;
    supabaseUrl?: string;
    supabaseKey?: string;
    dbPassword?: string;
    verbose?: boolean;
  }) => {
    if (options.print === true) {
      // Print full migration SQL
      const sql = getMigrationSQL({
        includeRls: options.rls,
        includeViews: options.views,
      });
      console.log(sql);
      return;
    }

    if (options.auto === true) {
      // Auto-run migrations via direct PostgreSQL connection
      const supabaseUrl = options.supabaseUrl ?? process.env['SUPABASE_URL'];
      const dbPassword = options.dbPassword ?? process.env['SUPABASE_DB_PASSWORD'];

      if (supabaseUrl === undefined || supabaseUrl === '') {
        console.error('[ERROR] --supabase-url or SUPABASE_URL env var is required');
        process.exit(1);
      }

      if (dbPassword === undefined || dbPassword === '') {
        console.error('[ERROR] --db-password or SUPABASE_DB_PASSWORD env var is required for --auto');
        console.error('');
        console.error('Get your database password from:');
        console.error('  Supabase Dashboard > Settings > Database > Database password');
        console.error('');
        console.error('Then add to your .env file:');
        console.error('  SUPABASE_DB_PASSWORD=your-password-here');
        process.exit(1);
      }

      console.error('[INFO] Running auto-migration...');

      const result = await runAutoMigration({
        supabaseUrl,
        databasePassword: dbPassword,
        includeRls: options.rls,
        includeViews: options.views,
        verbose: options.verbose ?? false,
      });

      if (result.success) {
        console.error('');
        console.error('=== Migration Summary ===');
        console.error(`Tables created:   ${result.tablesCreated ? '✓' : '✗'}`);
        console.error(`Indexes created:  ${result.indexesCreated ? '✓' : '✗'}`);
        console.error(`RLS enabled:      ${result.rlsEnabled ? '✓' : 'skipped'}`);
        console.error(`Views created:    ${result.viewsCreated ? '✓' : 'skipped'}`);
        console.error('=========================');
        console.error('');
        console.error('[SUCCESS] Migration completed! You can now use --upload.');
        process.exit(0);
      } else {
        console.error('[ERROR] Migration failed:');
        for (const err of result.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
    }

    if (options.check === true) {
      // Check if migrations are needed
      const supabaseUrl = options.supabaseUrl ?? process.env['SUPABASE_URL'];
      // Use service role key to bypass RLS for checking tables
      const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
      const anonKey = options.supabaseKey ?? process.env['SUPABASE_ANON_KEY'];

      if (supabaseUrl === undefined || supabaseUrl === '') {
        console.error('[ERROR] --supabase-url or SUPABASE_URL env var is required');
        process.exit(1);
      }

      if ((serviceRoleKey === undefined || serviceRoleKey === '') && (anonKey === undefined || anonKey === '')) {
        console.error('[ERROR] SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY env var is required');
        process.exit(1);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const client = createSupabaseClient({
        url: supabaseUrl,
        anonKey: anonKey ?? '',
        serviceRoleKey,
      });

      // Import checkExistingTables for verbose output
      const { checkExistingTables } = await import('../supabase/migrations.js');
      
      if (options.verbose === true) {
        console.error('[DEBUG] Checking tables with verbose mode...');
      }
      
      const { existing, missing } = await checkExistingTables(client, options.verbose === true);
      
      if (missing.length > 0) {
        console.error('[INFO] Database tables are missing. Migration is needed.');
        console.error(`[INFO] Missing tables: ${missing.join(', ')}`);
        if (existing.length > 0) {
          console.error(`[INFO] Existing tables: ${existing.join(', ')}`);
        }
        console.error('[INFO] Run: pnpm parse-boa migrate --auto');
        process.exit(1);
      } else {
        console.error('[INFO] All database tables exist. No migration needed.');
        process.exit(0);
      }
    }

    // Default: show help
    console.error('Usage: pnpm parse-boa migrate [options]');
    console.error('');
    console.error('Options:');
    console.error('  --print        Print the full migration SQL to stdout');
    console.error('  --check        Check if migrations are needed');
    console.error('  --auto         Automatically run migrations (requires SUPABASE_DB_PASSWORD)');
    console.error('  --no-rls       Exclude RLS policies from output');
    console.error('  --no-views     Exclude views from output');
    console.error('  -v, --verbose  Verbose output');
  });

interface CliOptions {
  inputDir?: string;
  out?: string;
  verbose: boolean;
  strict: boolean;
  pretty: boolean;
  single: boolean;
  schemaVersion?: string;
  format: string;
  splitAccounts: boolean;
  trainMl: boolean;
  ml: boolean;
  model?: string;
  modelOut?: string;
  epochs: string;
  detectRecurring: boolean;
  upload: boolean;
  supabaseUrl?: string;
  supabaseKey?: string;
  userId?: string;
}

/**
 * Process a directory of PDF files
 */
async function processDirectory(inputDir: string, options: CliOptions): Promise<void> {
  const dirPath = resolve(inputDir);
  
  // Resolve schema version with precedence: CLI > env > config > default
  const schemaVersion = resolveSchemaVersion({ cliVersion: options.schemaVersion });

  if (options.verbose) {
    console.error(`[INFO] Batch mode: scanning directory`);
    console.error(`[INFO] Directory: ${dirPath}`);
    console.error(`[INFO] Parser version: ${PARSER_VERSION}`);
    console.error(`[INFO] Schema version: ${schemaVersion}`);
    console.error(`[INFO] Strict mode: ${options.strict ? 'enabled' : 'disabled'}`);
  }
  
  // Validate directory
  const validation = await validateDirectory(dirPath);
  if (!validation.valid) {
    console.error(`[ERROR] ${validation.error}`);
    process.exit(1);
  }
  
  // Scan for PDFs
  const scanResult = await scanDirectoryForPdfs(dirPath);
  
  if (scanResult.files.length === 0) {
    console.error('[ERROR] No PDF files found in directory');
    if (scanResult.skipped.length > 0) {
      console.error('[INFO] Skipped files:');
      for (const skip of scanResult.skipped) {
        console.error(`  - ${skip.fileName}: ${skip.reason}`);
      }
    }
    process.exit(1);
  }
  
  if (options.verbose) {
    console.error(`[INFO] Found ${scanResult.files.length} PDF file(s)`);
    if (scanResult.skipped.length > 0) {
      console.error(`[INFO] Skipped ${scanResult.skipped.length} file(s)`);
    }
    if (options.ml) {
      console.error(`[INFO] ML categorization: enabled`);
      console.error(`[INFO] Model path: ${options.model ?? './models/categorizer'}`);
    }
  }
  
  // Process all PDFs
  const result = await processBatch(scanResult.files, {
    strict: options.strict,
    verbose: options.verbose,
    onProgress: (current, total, filename) => {
      console.error(`[INFO] Parsing ${current}/${total}: ${filename}`);
    },
    onError: (error: ParseError) => {
      console.error(`[ERROR] Failed to parse ${error.filename}: ${error.error}`);
    },
  });
  
  // Print summary
  console.error('');
  console.error('=== Batch Processing Summary ===');
  console.error(`Total PDFs found:       ${result.summary.totalPdfsFound}`);
  console.error(`PDFs succeeded:         ${result.summary.pdfsSucceeded}`);
  console.error(`PDFs failed:            ${result.summary.pdfsFailed}`);
  console.error(`Statements before dedup: ${result.summary.statementsBeforeDedup}`);
  console.error(`Statements kept:        ${result.totalStatements}`);
  console.error(`Statements deduped:     ${result.summary.duplicateStatementsRemoved}`);
  console.error(`Transactions merged:    ${result.totalTransactions}`);
  console.error(`Transactions deduped:   ${result.summary.duplicateTransactionsRemoved}`);
  console.error('================================');

  // Apply ML categorization if enabled
  if (options.ml) {
    const modelPath = resolve(options.model ?? './models/categorizer');
    console.error(`[INFO] Loading ML model from: ${modelPath}`);
    
    const categorizer = new HybridCategorizer();
    await categorizer.initialize();
    await categorizer.loadMLModel(modelPath);
    
    console.error('[INFO] Re-categorizing transactions with ML...');
    
    let mlRecategorized = 0;
    let mlImproved = 0;
    
    for (const stmt of result.statements) {
      for (const tx of stmt.transactions) {
        const mlResult = await categorizer.categorizeAsync(tx.description);
        
        // Update if ML provides better categorization
        if (mlResult.source === 'ml' || mlResult.source === 'hybrid') {
          if (tx.category === 'Uncategorized' || mlResult.confidence > tx.confidence) {
            const wasUncategorized = tx.category === 'Uncategorized';
            tx.category = mlResult.category;
            tx.subcategory = mlResult.subcategory;
            tx.confidence = mlResult.confidence;
            mlRecategorized++;
            if (wasUncategorized && mlResult.category !== 'Uncategorized') {
              mlImproved++;
            }
          }
        }
      }
    }
    
    console.error(`[INFO] ML re-categorized: ${mlRecategorized} transactions`);
    console.error(`[INFO] ML improved (was Uncategorized): ${mlImproved} transactions`);
    
    categorizer.dispose();
  }
  
  // Build canonical output
  const canonical: CanonicalOutput = {
    statements: result.statements,
    totalStatements: result.totalStatements,
    totalTransactions: result.totalTransactions,
    ...(result.parseErrors.length > 0 ? { parseErrors: result.parseErrors } : {}),
  };

  // Convert to target schema version
  const output = toFinalResult(canonical, schemaVersion);

  // Validate output against schema (always validate in strict mode)
  if (options.strict) {
    validateOutputOrThrow(schemaVersion, output);
  }

  if (options.verbose) {
    console.error(`[INFO] Output schema version: ${schemaVersion}`);
    console.error(`[INFO] Output format: ${options.format}`);
  }
  
  // Generate output based on format
  const format = options.format.toLowerCase() as OutputFormat;
  
  if (format === 'ofx') {
    // OFX requires v2 format
    const v2Output = toFinalResultV2(canonical);
    
    if (options.splitAccounts) {
      // Split into separate files per account
      const splitResults = exportOfxByAccount(v2Output);
      
      if (options.verbose) {
        console.error(`[INFO] Splitting OFX into ${splitResults.length} account file(s)`);
      }
      
      // Determine output directory (use --out as directory or current dir)
      const outDir = options.out !== undefined ? resolve(options.out) : process.cwd();
      
      for (const result of splitResults) {
        const filePath = resolve(outDir, result.filename);
        await writeFile(filePath, result.content, 'utf-8');
        console.error(`[INFO] Written: ${filePath} (${result.accountType} ****${result.accountLast4})`);
      }
    } else {
      // Single combined OFX file
      const outputContent = exportOfx(v2Output);
      if (options.verbose) {
        console.error(`[INFO] Generated OFX with ${v2Output.accounts.length} account(s)`);
      }
      
      if (options.out !== undefined) {
        const outPath = resolve(options.out);
        await writeFile(outPath, outputContent, 'utf-8');
        console.error(`[INFO] Output written to: ${outPath}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(outputContent);
      }
    }
  } else if (format === 'csv') {
    // CSV requires v2 format
    const v2Output = toFinalResultV2(canonical);
    
    if (options.splitAccounts) {
      // Split into separate files per account
      const splitResults = exportCsvByAccount(v2Output);
      
      if (options.verbose) {
        console.error(`[INFO] Splitting CSV into ${splitResults.length} account file(s)`);
      }
      
      // Determine output directory (use --out as directory or current dir)
      const outDir = options.out !== undefined ? resolve(options.out) : process.cwd();
      
      for (const result of splitResults) {
        const filePath = resolve(outDir, result.filename);
        await writeFile(filePath, result.content, 'utf-8');
        console.error(`[INFO] Written: ${filePath} (${result.accountType} ****${result.accountLast4})`);
      }
    } else {
      // Single combined CSV file
      const outputContent = exportCsv(v2Output);
      if (options.verbose) {
        console.error(`[INFO] Generated CSV with ${v2Output.totalTransactions} transaction(s)`);
      }
      
      if (options.out !== undefined) {
        const outPath = resolve(options.out);
        await writeFile(outPath, outputContent, 'utf-8');
        console.error(`[INFO] Output written to: ${outPath}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(outputContent);
      }
    }
  } else {
    // Default JSON output
    let finalOutput: unknown = output;
    
    // Add recurring detection if enabled
    if (options.detectRecurring) {
      if (options.verbose) {
        console.error('[INFO] Detecting recurring transactions...');
      }
      
      const recurringResult = detectRecurringFromStatements(result.statements);
      
      if (options.verbose) {
        console.error(`[INFO] Found ${recurringResult.summary.totalPatterns} recurring pattern(s)`);
        console.error(`[INFO] ${recurringResult.summary.totalRecurringTransactions} transactions identified as recurring`);
        console.error(`[INFO] Estimated monthly recurring: $${recurringResult.summary.estimatedMonthlyRecurring.toFixed(2)}`);
        console.error(`[INFO] Subscriptions detected: ${recurringResult.summary.subscriptionCount}`);
      }
      
      // Merge recurring data into output
      finalOutput = {
        ...(output as object),
        recurring: recurringResult,
      };
    }
    
    const outputContent = options.pretty
      ? JSON.stringify(finalOutput, null, 2)
      : JSON.stringify(finalOutput);
    
    if (options.out !== undefined) {
      const outPath = resolve(options.out);
      await writeFile(outPath, outputContent, 'utf-8');
      console.error(`[INFO] Output written to: ${outPath}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(outputContent);
    }
  }
  
  // Upload to Supabase if requested
  if (options.upload) {
    await uploadToSupabase(canonical, schemaVersion, options);
  }
  
  // Exit with error if ALL PDFs failed
  if (result.summary.pdfsSucceeded === 0) {
    process.exit(1);
  }
  
  process.exit(0);
}

/**
 * Upload parsed results to Supabase.
 */
async function uploadToSupabase(
  canonical: CanonicalOutput,
  schemaVersion: string,
  options: CliOptions
): Promise<void> {
  // Validate required options
  if (options.userId === undefined || options.userId === '') {
    console.error('[ERROR] --user-id is required for --upload');
    process.exit(1);
  }

  const supabaseUrl = options.supabaseUrl ?? process.env['SUPABASE_URL'];
  const supabaseKey = options.supabaseKey ?? process.env['SUPABASE_ANON_KEY'];

  if (supabaseUrl === undefined || supabaseUrl === '') {
    console.error('[ERROR] --supabase-url or SUPABASE_URL env var is required for --upload');
    process.exit(1);
  }

  if (supabaseKey === undefined || supabaseKey === '') {
    console.error('[ERROR] --supabase-key or SUPABASE_ANON_KEY env var is required for --upload');
    process.exit(1);
  }

  if (options.verbose) {
    console.error('[INFO] Uploading to Supabase...');
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const client = createSupabaseClient({
      url: supabaseUrl,
      anonKey: supabaseKey,
    });

    // Check if database tables exist
    const migrationNeeded = await needsMigration(client);
    if (migrationNeeded) {
      console.error('[ERROR] Supabase database tables not found.');
      console.error('');
      console.error('Please run the schema migrations in Supabase Dashboard > SQL Editor.');
      console.error('You can find the SQL files at:');
      console.error('  .windsurf/skills/supabase-bank-ledger-schema/references/schema.sql');
      console.error('  .windsurf/skills/supabase-bank-ledger-schema/references/rls-policies.sql');
      console.error('  .windsurf/skills/supabase-bank-ledger-schema/references/views.sql');
      console.error('');
      console.error('Or generate the full migration SQL with:');
      console.error('  pnpm parse-boa migrate --print');
      process.exit(1);
    }

    // Convert to v2 format for import
    const v2Output = toFinalResultV2(canonical);

    // Create parse run record
    const parseRunResult = await importParseRun(client, options.userId, {
      schemaVersion,
      status: 'success',
      warnings: canonical.statements.flatMap((s) => s.metadata.warnings),
      outputSnapshot: v2Output,
    });

    if (options.verbose) {
      console.error(`[INFO] Created parse run: ${parseRunResult.parseRunId}`);
    }

    // Import the v2 result
    const importResult = await importV2Result(client, options.userId, {
      result: v2Output,
      parseRunId: parseRunResult.parseRunId,
    });

    console.error('');
    console.error('=== Supabase Upload Summary ===');
    console.error(`Accounts created:       ${importResult.accountsCreated}`);
    console.error(`Accounts existing:      ${importResult.accountsExisting}`);
    console.error(`Statements created:     ${importResult.statementsCreated}`);
    console.error(`Statements updated:     ${importResult.statementsUpdated}`);
    console.error(`Transactions inserted:  ${importResult.transactionsInserted}`);
    console.error(`Transactions skipped:   ${importResult.transactionsSkipped}`);
    console.error('===============================');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] Supabase upload failed: ${message}`);
    if (options.verbose && error instanceof Error && error.stack !== undefined) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Process a single PDF file (original behavior)
 */
async function processSingleFile(pdfFile: string, options: CliOptions): Promise<void> {
  const filePath = resolve(pdfFile);

  // Resolve schema version with precedence: CLI > env > config > default
  const schemaVersion = resolveSchemaVersion({ cliVersion: options.schemaVersion });

  if (options.verbose) {
    console.error(`[INFO] Parsing: ${filePath}`);
    console.error(`[INFO] Parser version: ${PARSER_VERSION}`);
    console.error(`[INFO] Schema version: ${schemaVersion}`);
    console.error(`[INFO] Strict mode: ${options.strict ? 'enabled' : 'disabled'}`);
    console.error(`[INFO] Multi-statement mode: ${options.single ? 'disabled' : 'enabled'}`);
  }

  const pdf = await extractPDF(filePath);

  if (options.verbose) {
    console.error(`[INFO] Extracted ${pdf.totalPages} pages`);
    console.error(`[INFO] Total text length: ${pdf.fullText.length} characters`);
  }

  let output: unknown;
  let canonical: CanonicalOutput | null = null;

  if (options.single) {
    // Legacy single-statement mode
    const result = parseBoaStatement(pdf, {
      strict: options.strict,
      verbose: options.verbose,
    });

    if (options.verbose) {
      console.error(`[INFO] Detected account type: ${result.statement.account.accountType}`);
      console.error(`[INFO] Found ${result.statement.transactions.length} transactions`);
      if (result.statement.metadata.warnings.length > 0) {
        console.error(`[WARN] Warnings:`);
        for (const warning of result.statement.metadata.warnings) {
          console.error(`  - ${warning}`);
        }
      }
    }

    if (options.strict) {
      const validation = ParsedStatementSchema.safeParse(result.statement);
      if (!validation.success) {
        console.error('[ERROR] Schema validation failed:');
        for (const issue of validation.error.issues) {
          console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        }
        process.exit(1);
      }
    }

    output = result.statement;
  } else {
    // Multi-statement mode (default)
    const result = parseBoaMultipleStatements(pdf, {
      strict: options.strict,
      verbose: options.verbose,
    });

    if (options.verbose) {
      console.error(`[INFO] Found ${result.statements.length} statement(s)`);
      console.error(`[INFO] Total transactions: ${result.totalTransactions}`);
      for (let i = 0; i < result.statements.length; i++) {
        const stmt = result.statements[i];
        if (stmt) {
          console.error(`[INFO] Statement ${i + 1}: ${stmt.account.statementPeriod.start} to ${stmt.account.statementPeriod.end}`);
          console.error(`[INFO]   - Transactions: ${stmt.transactions.length}`);
          console.error(`[INFO]   - Beginning: $${stmt.summary.startingBalance.toFixed(2)}, Ending: $${stmt.summary.endingBalance.toFixed(2)}`);
          if (stmt.metadata.warnings.length > 0) {
            console.error(`[WARN]   Warnings:`);
            for (const warning of stmt.metadata.warnings) {
              console.error(`    - ${warning}`);
            }
          }
        }
      }
    }

    if (options.strict) {
      for (const stmt of result.statements) {
        const validation = ParsedStatementSchema.safeParse(stmt);
        if (!validation.success) {
          console.error(`[ERROR] Schema validation failed for statement ${stmt.account.statementPeriod.start}:`);
          for (const issue of validation.error.issues) {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
          }
          process.exit(1);
        }
      }
    }

    // Apply ML categorization if enabled
    if (options.ml) {
      const modelPath = resolve(options.model ?? './models/categorizer');
      console.error(`[INFO] Loading ML model from: ${modelPath}`);
      
      const categorizer = new HybridCategorizer();
      await categorizer.initialize();
      await categorizer.loadMLModel(modelPath);
      
      console.error('[INFO] Re-categorizing transactions with ML...');
      
      let mlRecategorized = 0;
      let mlImproved = 0;
      
      for (const stmt of result.statements) {
        for (const tx of stmt.transactions) {
          const mlResult = await categorizer.categorizeAsync(tx.description);
          
          // Update if ML provides better categorization
          if (mlResult.source === 'ml' || mlResult.source === 'hybrid') {
            if (tx.category === 'Uncategorized' || mlResult.confidence > tx.confidence) {
              const wasUncategorized = tx.category === 'Uncategorized';
              tx.category = mlResult.category;
              tx.subcategory = mlResult.subcategory;
              tx.confidence = mlResult.confidence;
              mlRecategorized++;
              if (wasUncategorized && mlResult.category !== 'Uncategorized') {
                mlImproved++;
              }
            }
          }
        }
      }
      
      console.error(`[INFO] ML re-categorized: ${mlRecategorized} transactions`);
      console.error(`[INFO] ML improved (was Uncategorized): ${mlImproved} transactions`);
      
      categorizer.dispose();
    }

    // Build canonical output
    canonical = {
      statements: result.statements,
      totalStatements: result.statements.length,
      totalTransactions: result.totalTransactions,
    };

    // Convert to target schema version
    output = toFinalResult(canonical, schemaVersion);

    // Validate output against schema (always validate in strict mode)
    if (options.strict) {
      validateOutputOrThrow(schemaVersion, output);
    }
  }

  if (options.verbose) {
    console.error(`[INFO] Output schema version: ${schemaVersion}`);
    console.error(`[INFO] Output format: ${options.format}`);
  }

  // Generate output based on format
  const format = options.format.toLowerCase() as OutputFormat;
  let outputContent: string;
  
  if (format === 'ofx') {
    // OFX requires v2 format - build canonical if in single mode
    if (options.single || canonical === null) {
      console.error('[ERROR] OFX format requires multi-statement mode. Remove --single flag.');
      process.exit(1);
    }
    const v2Output = toFinalResultV2(canonical);
    outputContent = exportOfx(v2Output);
    if (options.verbose) {
      console.error(`[INFO] Generated OFX with ${v2Output.accounts.length} account(s)`);
    }
  } else if (format === 'csv') {
    // CSV requires v2 format - build canonical if in single mode
    if (options.single || canonical === null) {
      console.error('[ERROR] CSV format requires multi-statement mode. Remove --single flag.');
      process.exit(1);
    }
    const v2Output = toFinalResultV2(canonical);
    outputContent = exportCsv(v2Output);
    if (options.verbose) {
      console.error(`[INFO] Generated CSV with ${v2Output.totalTransactions} transaction(s)`);
    }
  } else {
    // Default JSON output
    let finalOutput: unknown = output;
    
    // Add recurring detection if enabled (only for multi-statement mode)
    if (options.detectRecurring && !options.single && canonical !== null) {
      if (options.verbose) {
        console.error('[INFO] Detecting recurring transactions...');
      }
      
      const recurringResult = detectRecurringFromStatements(canonical.statements);
      
      if (options.verbose) {
        console.error(`[INFO] Found ${recurringResult.summary.totalPatterns} recurring pattern(s)`);
        console.error(`[INFO] ${recurringResult.summary.totalRecurringTransactions} transactions identified as recurring`);
        console.error(`[INFO] Estimated monthly recurring: $${recurringResult.summary.estimatedMonthlyRecurring.toFixed(2)}`);
        console.error(`[INFO] Subscriptions detected: ${recurringResult.summary.subscriptionCount}`);
      }
      
      // Merge recurring data into output
      finalOutput = {
        ...(output as object),
        recurring: recurringResult,
      };
    }
    
    outputContent = options.pretty
      ? JSON.stringify(finalOutput, null, 2)
      : JSON.stringify(finalOutput);
  }

  if (options.out !== undefined) {
    const outPath = resolve(options.out);
    await writeFile(outPath, outputContent, 'utf-8');
    if (options.verbose) {
      console.error(`[INFO] Output written to: ${outPath}`);
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(outputContent);
  }

  // Upload to Supabase if requested (only for multi-statement mode)
  if (options.upload && !options.single && canonical !== null) {
    await uploadToSupabase(canonical, schemaVersion, options);
  } else if (options.upload && options.single) {
    console.error('[WARN] --upload requires multi-statement mode. Remove --single flag to enable upload.');
  }

  process.exit(0);
}

/**
 * Train ML categorizer from parsed transactions
 */
async function trainMLModel(options: CliOptions): Promise<void> {
  const epochs = parseInt(options.epochs, 10);
  
  if (options.verbose) {
    console.error('[INFO] ML Training Mode');
    console.error(`[INFO] Epochs: ${epochs}`);
  }

  let trainingData: TrainingExample[] = [];

  // If inputDir is provided, parse PDFs and extract training data from categorized transactions
  if (options.inputDir !== undefined) {
    const dirPath = resolve(options.inputDir);
    
    if (options.verbose) {
      console.error(`[INFO] Extracting training data from: ${dirPath}`);
    }

    // Validate and scan directory
    const validation = await validateDirectory(dirPath);
    if (!validation.valid) {
      console.error(`[ERROR] ${validation.error}`);
      process.exit(1);
    }

    const scanResult = await scanDirectoryForPdfs(dirPath);
    if (scanResult.files.length === 0) {
      console.error('[ERROR] No PDF files found in directory');
      process.exit(1);
    }

    console.error(`[INFO] Found ${scanResult.files.length} PDF file(s)`);

    // Process PDFs to get transactions
    const result = await processBatch(scanResult.files, {
      strict: options.strict,
      verbose: options.verbose,
      onProgress: (current, total, filename) => {
        console.error(`[INFO] Parsing ${current}/${total}: ${filename}`);
      },
      onError: (error: ParseError) => {
        console.error(`[ERROR] Failed to parse ${error.filename}: ${error.error}`);
      },
    });

    // Extract training examples from parsed transactions
    // Note: ParsedStatement uses flattened structure with category/subcategory directly on transaction
    const parsedExamples: Array<{ description: string; category: string; subcategory: string | null }> = [];
    
    for (const stmt of result.statements) {
      for (const tx of stmt.transactions) {
        // Only use transactions that were successfully categorized (not Uncategorized)
        if (tx.category !== 'Uncategorized') {
          parsedExamples.push({
            description: tx.description,
            category: tx.category,
            subcategory: tx.subcategory,
          });
        }
      }
    }

    console.error(`[INFO] Extracted ${parsedExamples.length} categorized transactions for training`);

    // Convert to training examples
    trainingData = generateFromParsedTransactions(
      parsedExamples as Array<{ description: string; category: import('../types/output.js').Category; subcategory: import('../types/output.js').Subcategory }>
    );

    // Augment with synthetic data to improve coverage
    const syntheticData = generateTrainingData(2000);
    trainingData = [...trainingData, ...syntheticData];
    
    console.error(`[INFO] Total training examples: ${trainingData.length} (${parsedExamples.length} from PDFs + ${syntheticData.length} synthetic)`);
  } else {
    // No input directory - use only synthetic training data
    console.error('[INFO] No --inputDir provided, using synthetic training data only');
    trainingData = generateTrainingData(5000);
    console.error(`[INFO] Generated ${trainingData.length} synthetic training examples`);
  }

  // Initialize and train the ML categorizer
  console.error('[INFO] Initializing ML categorizer...');
  const categorizer = new HybridCategorizer();
  await categorizer.initialize();

  console.error('[INFO] Training ML model...');
  console.error('[INFO] This may take a few minutes...');
  
  await categorizer.trainML(trainingData, { epochs, batchSize: 32 });

  console.error('[INFO] Training complete!');
  console.error(categorizer.getMLModelSummary());

  // Save the model if output path is specified
  const modelOutPath = options.modelOut ?? options.model;
  if (modelOutPath !== undefined) {
    const modelPath = resolve(modelOutPath);
    
    // Ensure directory exists
    await mkdir(dirname(modelPath), { recursive: true });
    
    console.error(`[INFO] Saving model to: ${modelPath}`);
    await categorizer.saveMLModel(modelPath);
    console.error('[INFO] Model saved successfully!');
  } else {
    console.error('[WARN] No --model-out specified, model not saved');
  }

  categorizer.dispose();
  process.exit(0);
}

// Init command - initialize project with required files
program
  .command('init')
  .description('Initialize project with .env file and ML model directory')
  .option('--force', 'Overwrite existing files', false)
  .option('--no-model', 'Skip copying ML model files')
  .action(async (options: { force: boolean; model: boolean }) => {
    const cwd = process.cwd();
    let filesCreated = 0;
    let filesSkipped = 0;

    console.log('Initializing boa-statement-parser...\n');

    // 1. Create .env file
    const envPath = resolve(cwd, '.env');
    const envExists = await fileExists(envPath);
    
    if (envExists && !options.force) {
      console.log('  [SKIP] .env already exists (use --force to overwrite)');
      filesSkipped++;
    } else {
      const envContent = generateEnvTemplate();
      await writeFile(envPath, envContent, 'utf-8');
      console.log('  [CREATE] .env');
      filesCreated++;
    }

    // 2. Create models directory and copy pre-trained model
    if (options.model) {
      const modelsDir = resolve(cwd, 'models', 'categorizer');
      const modelJsonPath = resolve(modelsDir, 'model.json');
      const modelJsonExists = await fileExists(modelJsonPath);

      if (modelJsonExists && !options.force) {
        console.log('  [SKIP] models/categorizer already exists (use --force to overwrite)');
        filesSkipped++;
      } else {
        // Get the package's model directory
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const packageModelDir = resolve(__dirname, '..', '..', 'models', 'categorizer');
        
        // Check if package has bundled model
        const packageModelJson = resolve(packageModelDir, 'model.json');
        const packageModelExists = await fileExists(packageModelJson);

        if (packageModelExists) {
          // Create models directory
          await mkdir(modelsDir, { recursive: true });
          
          // Copy model files
          await copyFile(packageModelJson, resolve(modelsDir, 'model.json'));
          await copyFile(resolve(packageModelDir, 'weights.bin'), resolve(modelsDir, 'weights.bin'));
          console.log('  [CREATE] models/categorizer/model.json');
          console.log('  [CREATE] models/categorizer/weights.bin');
          filesCreated += 2;
        } else {
          console.log('  [SKIP] Pre-trained model not found in package');
          console.log('         You can train your own model with: parse-boa --train-ml --inputDir <dir>');
          filesSkipped++;
        }
      }
    } else {
      console.log('  [SKIP] ML model (--no-model specified)');
      filesSkipped++;
    }

    // 3. Create statements directory (optional convenience)
    const statementsDir = resolve(cwd, 'statements');
    const statementsDirExists = await fileExists(statementsDir);
    
    if (!statementsDirExists) {
      await mkdir(statementsDir, { recursive: true });
      console.log('  [CREATE] statements/ (place your PDF files here)');
      filesCreated++;
    }

    console.log(`\n✓ Initialization complete!`);
    console.log(`  Files created: ${filesCreated}`);
    console.log(`  Files skipped: ${filesSkipped}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Edit .env to configure your settings`);
    console.log(`  2. Place your Bank of America PDF statements in ./statements/`);
    console.log(`  3. Run: parse-boa --inputDir ./statements --out result.json`);
    
    process.exit(0);
  });

// Helper to check if file exists
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Generate .env template content
function generateEnvTemplate(): string {
  return `# BOA Statement Parser Environment Variables
# Generated by: parse-boa init
# Documentation: https://github.com/RubenAvetisyan/boa-statement-parser#environment-variables

# =============================================================================
# INPUT/OUTPUT SETTINGS
# =============================================================================

# Input directory containing PDF files to process (equivalent to --inputDir)
BOA_INPUT_DIR=./statements

# Output file path (equivalent to --out)
BOA_OUTPUT_FILE=result.json

# Output format: json, ofx, csv (equivalent to --format)
BOA_FORMAT=json

# =============================================================================
# PARSING OPTIONS
# =============================================================================

# Schema version: v1 (flat) or v2 (rollup with analytics)
FINAL_RESULT_SCHEMA_VERSION=v2

# Enable verbose output (true/false)
# BOA_VERBOSE=false

# Enable strict validation (true/false)
# BOA_STRICT=false

# =============================================================================
# ML CATEGORIZATION
# =============================================================================

# Enable ML-based categorization (true/false)
# When enabled, uses TensorFlow.js ML model for better categorization
BOA_ML=true

# Path to ML model directory (defaults to ./models/categorizer when BOA_ML=true)
# BOA_MODEL_PATH=./models/categorizer

# =============================================================================
# RUNTIME (optional)
# =============================================================================

# Suppress TensorFlow warnings (0-3, higher = less verbose)
TF_CPP_MIN_LOG_LEVEL=2
`;
}

// Plaid subcommand
program
  .command('plaid')
  .description('Plaid API integration commands')
  .argument('<action>', 'Action: link, list, status, sync, remove, reconcile, identity, auth, liabilities, holdings, test')
  .option('--item-id <id>', 'Plaid item ID')
  .option('--user-id <id>', 'User ID for Plaid operations', process.env['BOA_USER_ID'])
  .option('--full', 'Full sync (ignore cursor)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (action: string, options: {
    itemId?: string;
    userId?: string;
    full?: boolean;
    verbose?: boolean;
  }) => {
    const {
      isPlaidConfigured,
      testPlaidConnection,
      createSandboxPublicToken,
      exchangePublicToken,
      getItem,
      removeItem,
      syncItemTransactions,
      getAccounts,
      getFilePlaidItemStore,
    } = await import('../plaid/index.js');

    // Use file-based store for CLI persistence
    const store = getFilePlaidItemStore();

    if (!isPlaidConfigured()) {
      console.error('[ERROR] Plaid is not configured.');
      console.error('');
      console.error('Please set the following environment variables:');
      console.error('  PLAID_CLIENT_ID=your-client-id');
      console.error('  PLAID_SECRET=your-secret');
      console.error('  PLAID_ENV=sandbox (or production)');
      console.error('');
      console.error('Get these from: https://dashboard.plaid.com/team/keys');
      process.exit(1);
    }

    try {
      switch (action) {
        case 'test': {
          console.error('[INFO] Testing Plaid connection...');
          const result = await testPlaidConnection();
          if (result.success) {
            console.error(`[SUCCESS] Connected to Plaid (${result.environment})`);
          } else {
            console.error(`[ERROR] Connection failed: ${result.error}`);
            process.exit(1);
          }
          break;
        }

        case 'link': {
          if (options.userId === undefined || options.userId === '') {
            console.error('[ERROR] --user-id is required for link');
            process.exit(1);
          }

          console.error('[INFO] Creating sandbox public token for testing...');
          const { publicToken } = await createSandboxPublicToken();
          console.error(`[INFO] Public token: ${publicToken.slice(0, 20)}...`);

          console.error('[INFO] Exchanging for access token...');
          const exchangeResult = await exchangePublicToken(publicToken);
          console.error(`[SUCCESS] Item linked: ${exchangeResult.itemId}`);

          // Get item details
          const itemInfo = await getItem(exchangeResult.accessToken);
          console.error(`[INFO] Institution: ${itemInfo.institutionId}`);

          // Get accounts
          const accounts = await getAccounts(exchangeResult.accessToken);
          console.error(`[INFO] Accounts: ${accounts.length}`);
          for (const acc of accounts) {
            console.error(`  - ${acc.name} (${acc.type}/${acc.subtype ?? 'N/A'}) ****${acc.mask ?? '????'}`);
          }

          // Save to file store for persistence
          await store.saveItem({
            itemId: exchangeResult.itemId,
            accessToken: exchangeResult.accessToken,
            institutionId: itemInfo.institutionId ?? 'unknown',
            institutionName: 'Sandbox Bank',
            userId: options.userId,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          console.error('');
          console.error('=== Link Complete ===');
          console.error(`Item ID: ${exchangeResult.itemId}`);
          console.error(`Stored at: ${store.getFilePath()}`);
          console.error('');
          console.error('Next steps:');
          console.error('  pnpm parse-boa plaid list              # List all linked items');
          console.error('  pnpm parse-boa plaid sync --item-id <id>  # Sync transactions');
          break;
        }

        case 'list': {
          const items = await store.getAllItems();
          if (items.length === 0) {
            console.error('[INFO] No Plaid items linked yet.');
            console.error('Use: pnpm parse-boa plaid link');
          } else {
            console.error('');
            console.error('=== Linked Plaid Items ===');
            for (const item of items) {
              console.error(``);
              console.error(`  Item ID:     ${item.itemId}`);
              console.error(`  Institution: ${item.institutionName}`);
              console.error(`  Status:      ${item.status}`);
              console.error(`  Last Sync:   ${item.lastSyncAt ?? 'Never'}`);
            }
            console.error('');
            console.error(`Store file: ${store.getFilePath()}`);
          }
          break;
        }

        case 'status': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for status');
            console.error('Use: pnpm parse-boa plaid list  to see available items');
            process.exit(1);
          }

          const item = await store.getItem(options.itemId);

          if (item === null) {
            console.error(`[ERROR] Item not found: ${options.itemId}`);
            process.exit(1);
          }

          const itemInfo = await getItem(item.accessToken);

          console.error('');
          console.error('=== Item Status ===');
          console.error(`Item ID:      ${item.itemId}`);
          console.error(`Institution:  ${item.institutionName}`);
          console.error(`Status:       ${item.status}`);
          console.error(`Last Sync:    ${item.lastSyncAt ?? 'Never'}`);
          console.error(`Cursor:       ${item.syncCursor !== undefined ? 'Set' : 'Not set'}`);
          console.error(`Update Type:  ${itemInfo.updateType}`);
          if (itemInfo.error !== null) {
            console.error(`Error:        ${itemInfo.error.errorMessage}`);
          }
          break;
        }

        case 'sync': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for sync');
            process.exit(1);
          }

          console.error(`[INFO] Syncing transactions for item: ${options.itemId}`);

          if (options.full === true) {
            await store.updateSyncCursor(options.itemId, '');
            console.error('[INFO] Full sync requested, cursor reset');
          }

          const result = await syncItemTransactions(
            options.itemId,
            (batch) => {
              if (options.verbose === true) {
                console.error(`[INFO] Batch: +${batch.added.length} added, ~${batch.modified.length} modified, -${batch.removed.length} removed`);
              }
            },
            store
          );

          console.error('');
          console.error('=== Sync Complete ===');
          console.error(`Added:    ${result.added.length}`);
          console.error(`Modified: ${result.modified.length}`);
          console.error(`Removed:  ${result.removed.length}`);

          // Output transactions as JSON
          if (result.added.length > 0) {
            console.log(JSON.stringify(result.added, null, 2));
          }
          break;
        }

        case 'remove': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for remove');
            console.error('Use: pnpm parse-boa plaid list  to see available items');
            process.exit(1);
          }

          const removeItemData = await store.getItem(options.itemId);

          if (removeItemData === null) {
            console.error(`[ERROR] Item not found: ${options.itemId}`);
            process.exit(1);
          }

          console.error(`[INFO] Removing item: ${options.itemId}`);
          await removeItem(removeItemData.accessToken);
          await store.deleteItem(options.itemId);

          console.error('[SUCCESS] Item removed');
          break;
        }

        case 'reconcile': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for reconcile');
            console.error('Use: pnpm parse-boa plaid list  to see available items');
            process.exit(1);
          }

          // Import reconciliation and parsing modules
          const { reconcileTransactions, formatReconciliationReport } = await import('../plaid/reconcile.js');
          const { parseBoaMultipleStatements } = await import('../parsers/boa/index.js');
          const { extractPDF } = await import('../extractors/index.js');
          const fs = await import('fs');
          const path = await import('path');

          // Get PDF file from remaining args or prompt
          const pdfArg = process.argv.find((arg) => arg.endsWith('.pdf'));
          if (pdfArg === undefined) {
            console.error('[ERROR] PDF file path required for reconcile');
            console.error('Usage: pnpm parse-boa plaid reconcile --item-id <id> <path/to/statement.pdf>');
            process.exit(1);
          }

          const pdfPath = path.resolve(pdfArg);
          if (!fs.existsSync(pdfPath)) {
            console.error(`[ERROR] PDF file not found: ${pdfPath}`);
            process.exit(1);
          }

          console.error(`[INFO] Loading PDF: ${pdfPath}`);
          const pdfData = await extractPDF(pdfPath);
          const parseResult = parseBoaMultipleStatements(pdfData);

          if (parseResult.statements.length === 0) {
            console.error('[ERROR] No statements found in PDF');
            process.exit(1);
          }

          // Get all transactions from PDF
          const pdfTransactions = parseResult.statements.flatMap((s) => s.transactions);
          console.error(`[INFO] Found ${pdfTransactions.length} PDF transactions`);

          // Get Plaid transactions
          const item = await store.getItem(options.itemId);
          if (item === null) {
            console.error(`[ERROR] Item not found: ${options.itemId}`);
            process.exit(1);
          }

          console.error(`[INFO] Syncing Plaid transactions...`);
          const syncResult = await syncItemTransactions(options.itemId, undefined, store);
          const plaidTransactions = syncResult.added;
          console.error(`[INFO] Found ${plaidTransactions.length} Plaid transactions`);

          // Reconcile
          console.error('[INFO] Reconciling transactions...');
          const reconcileResult = reconcileTransactions(pdfTransactions, plaidTransactions);

          // Output report
          const report = formatReconciliationReport(reconcileResult);
          console.error('');
          console.error(report);

          // Output JSON to stdout
          console.log(JSON.stringify(reconcileResult, null, 2));
          break;
        }

        case 'identity': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for identity');
            console.error('Use: pnpm parse-boa plaid list  to see available items');
            process.exit(1);
          }

          const { getIdentity, formatIdentityReport } = await import('../plaid/identity.js');

          const identityItem = await store.getItem(options.itemId);
          if (identityItem === null) {
            console.error(`[ERROR] Item not found: ${options.itemId}`);
            process.exit(1);
          }

          console.error('[INFO] Fetching identity information...');
          const identityResult = await getIdentity(identityItem.accessToken);

          const identityReport = formatIdentityReport(identityResult);
          console.error('');
          console.error(identityReport);

          console.log(JSON.stringify(identityResult, null, 2));
          break;
        }

        case 'auth': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for auth');
            console.error('Use: pnpm parse-boa plaid list  to see available items');
            process.exit(1);
          }

          const { getAuth, formatAuthReport } = await import('../plaid/auth.js');

          const authItem = await store.getItem(options.itemId);
          if (authItem === null) {
            console.error(`[ERROR] Item not found: ${options.itemId}`);
            process.exit(1);
          }

          console.error('[INFO] Fetching auth information (account/routing numbers)...');
          console.error('[WARN] This contains sensitive data - handle with care!');
          const authResult = await getAuth(authItem.accessToken);

          const authReport = formatAuthReport(authResult, true); // masked by default
          console.error('');
          console.error(authReport);

          console.log(JSON.stringify(authResult, null, 2));
          break;
        }

        case 'liabilities': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for liabilities');
            console.error('Use: pnpm parse-boa plaid list  to see available items');
            process.exit(1);
          }

          const { getLiabilities, formatLiabilitiesReport } = await import('../plaid/liabilities.js');

          const liabilitiesItem = await store.getItem(options.itemId);
          if (liabilitiesItem === null) {
            console.error(`[ERROR] Item not found: ${options.itemId}`);
            process.exit(1);
          }

          console.error('[INFO] Fetching liabilities information...');
          const liabilitiesResult = await getLiabilities(liabilitiesItem.accessToken);

          const liabilitiesReport = formatLiabilitiesReport(liabilitiesResult);
          console.error('');
          console.error(liabilitiesReport);

          console.log(JSON.stringify(liabilitiesResult, null, 2));
          break;
        }

        case 'holdings': {
          if (options.itemId === undefined || options.itemId === '') {
            console.error('[ERROR] --item-id is required for holdings');
            console.error('Use: pnpm parse-boa plaid list  to see available items');
            process.exit(1);
          }

          const { getHoldings, formatHoldingsReport } = await import('../plaid/investments.js');

          const holdingsItem = await store.getItem(options.itemId);
          if (holdingsItem === null) {
            console.error(`[ERROR] Item not found: ${options.itemId}`);
            process.exit(1);
          }

          console.error('[INFO] Fetching investment holdings...');
          const holdingsResult = await getHoldings(holdingsItem.accessToken);

          const holdingsReport = formatHoldingsReport(holdingsResult);
          console.error('');
          console.error(holdingsReport);

          console.log(JSON.stringify(holdingsResult, null, 2));
          break;
        }

        default:
          console.error(`[ERROR] Unknown action: ${action}`);
          console.error('Valid actions: link, list, status, sync, remove, reconcile, identity, auth, liabilities, holdings, test');
          process.exit(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ERROR] ${message}`);
      if (options.verbose === true && error instanceof Error && error.stack !== undefined) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
