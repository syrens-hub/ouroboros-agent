#!/usr/bin/env node
/**
 * Build script for Adaptive Compression Engine
 * Compiles TypeScript to CommonJS for gateway loading
 *
 * Usage: node compile.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.dirname(__dirname);
const SRC_DIR = path.join(SKILL_DIR, 'src');
const OUT_DIR = path.join(SKILL_DIR, 'dist');

console.log('Building Adaptive Compression Engine...');

// Create output directory
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Compile TypeScript using npx tsc
try {
  execSync(
    `npx tsc src/*.ts --outDir dist --module CommonJS --target ES2022 --esModuleInterop --skipLibCheck 2>&1`,
    { cwd: SKILL_DIR, stdio: 'inherit' }
  );
  console.log('✅ Compilation successful');
  console.log(`Output: ${OUT_DIR}/`);
} catch (err) {
  console.error('❌ Compilation failed');
  process.exit(1);
}
