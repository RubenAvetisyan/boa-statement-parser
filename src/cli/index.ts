#!/usr/bin/env node

import { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { extractPDF } from '../extractors/index.js';
import { parseBoaStatement, parseBoaMultipleStatements } from '../parsers/index.js';
import { ParsedStatementSchema } from '../schemas/index.js';
import {
  resolveSchemaVersion,
  validateOutputOrThrow,
  AVAILABLE_SCHEMA_VERSIONS,
} from '../schemas/schema-registry.js';
import { toFinalResult, toFinalResultV2, exportOfx, exportOfxByAccount, exportCsv, exportCsvByAccount, type CanonicalOutput } from '../output/index.js';

const AVAILABLE_FORMATS = ['json', 'ofx', 'csv'] as const;
type OutputFormat = typeof AVAILABLE_FORMATS[number];
import { PARSER_VERSION } from '../utils/constants.js';
import { scanDirectoryForPdfs, validateDirectory } from '../utils/directory-scanner.js';
import { processBatch, type ParseError } from '../batch/index.js';

const program = new Command();

// Single PDF command (default)
program
  .name('parse-boa')
  .description('Parse Bank of America statement PDFs into structured JSON')
  .version(PARSER_VERSION)
  .argument('[pdf-file]', 'Path to the Bank of America statement PDF')
  .option('-d, --inputDir <directory>', 'Directory containing multiple PDF files to process')
  .option('-o, --out <file>', 'Output file path (default: stdout)')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('-s, --strict', 'Enable strict validation mode', false)
  .option('--pretty', 'Pretty-print JSON output', true)
  .option('--no-pretty', 'Disable pretty-printing')
  .option('--single', 'Parse as single statement (legacy mode)', false)
  .option(
    '--schema-version <version>',
    `Output schema version (${AVAILABLE_SCHEMA_VERSIONS.join(', ')})`,
    undefined
  )
  .option(
    '-f, --format <format>',
    `Output format (${AVAILABLE_FORMATS.join(', ')})`,
    'json'
  )
  .option(
    '--split-accounts',
    'Split output into separate files per account (only with --format ofx or csv)',
    false
  )
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
  }) => {
    try {
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
    const outputContent = options.pretty
      ? JSON.stringify(output, null, 2)
      : JSON.stringify(output);
    
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
    outputContent = options.pretty
      ? JSON.stringify(output, null, 2)
      : JSON.stringify(output);
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

program.parse();
