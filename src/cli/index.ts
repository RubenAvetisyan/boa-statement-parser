#!/usr/bin/env node

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
  
  // Exit with error if ALL PDFs failed
  if (result.summary.pdfsSucceeded === 0) {
    process.exit(1);
  }
  
  process.exit(0);
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

program.parse();
