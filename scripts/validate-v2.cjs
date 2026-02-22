/**
 * Validate result.json against the v2 schema.
 * Usage: node scripts/validate-v2.cjs [path-to-result.json]
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const AjvModule = require('ajv');
const ajvFormatsModule = require('ajv-formats');
const fs = require('fs');

const Ajv = AjvModule.default ?? AjvModule;
const addFormats = ajvFormatsModule.default ?? ajvFormatsModule;

const resultPath = process.argv[2] ?? './result.json';

const schema = JSON.parse(fs.readFileSync('schemas/final_result.v2.schema.json', 'utf-8'));
const data = JSON.parse(fs.readFileSync(resultPath, 'utf-8').replace(/^\uFEFF/, ''));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const valid = validate(data);

if (valid) {
  console.log('VALID: Output passes final_result.v2.schema.json');
} else {
  const errors = validate.errors ?? [];
  console.log(`INVALID: ${errors.length} error(s)`);
  for (const err of errors.slice(0, 20)) {
    console.log(`  ${err.instancePath} ${err.message}`);
  }
  process.exit(1);
}
