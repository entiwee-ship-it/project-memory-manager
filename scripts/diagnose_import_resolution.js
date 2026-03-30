#!/usr/bin/env node
/**
 * 诊断导入解析问题
 * 
 * 使用方法:
 *   node scripts/diagnose_import_resolution.js --root <project-root> --file <script-file>
 * 
 * 示例:
 *   node scripts/diagnose_import_resolution.js --root ./my-game --file ./my-game/app/modules/test.ts
 */

const fs = require('fs');
const path = require('path');
const { createExtractContext } = require('./adapters/extract');

function parseArgs(argv) {
    const args = { root: '', file: '', adapter: 'fullstack' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--root' && i + 1 < argv.length) {
            args.root = path.resolve(argv[++i]);
        } else if (argv[i] === '--file' && i + 1 < argv.length) {
            args.file = path.resolve(argv[++i]);
        } else if (argv[i] === '--adapter' && i + 1 < argv.length) {
            args.adapter = argv[++i];
        }
    }
    return args;
}

function extractImportsFromFile(filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const imports = [];
    const importPattern = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm;
    let match;
    while ((match = importPattern.exec(source))) {
        imports.push({
            clause: match[1].trim(),
            specifier: match[2].trim(),
        });
    }
    return imports;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    console.log('=== Import Resolution Diagnosis ===\n');
    console.log('Project Root:', args.root || '(not specified)');
    console.log('Script File:', args.file || '(not specified)');
    console.log('Adapter Mode:', args.adapter);
    
    if (!args.file) {
        console.error('\n❌ Error: --file is required');
        console.log('\nUsage: node scripts/diagnose_import_resolution.js --root <project-root> --file <script-file> [--adapter <mode>]');
        process.exit(1);
    }
    
    if (!fs.existsSync(args.file)) {
        console.error(`\n❌ Error: File not found: ${args.file}`);
        process.exit(1);
    }
    
    const root = args.root || process.cwd();
    const context = createExtractContext({ adapter: args.adapter }, root);
    
    console.log('\n--- Adapter Chain ---');
    context.adapters.forEach((adapter, i) => {
        console.log(`  ${i + 1}. ${adapter.name}`);
    });
    
    console.log('\n--- Context Info ---');
    console.log('  CWD:', context.cwd);
    console.log('  Mode:', context.adapterMode);
    
    console.log('\n--- Import Analysis ---');
    const imports = extractImportsFromFile(args.file);
    console.log(`  Found ${imports.length} imports\n`);
    
    let resolvedCount = 0;
    let unresolvedCount = 0;
    
    for (const imp of imports) {
        console.log(`  import { ${imp.clause.slice(0, 50)}${imp.clause.length > 50 ? '...' : ''} } from "${imp.specifier}"`);
        
        // Try each adapter
        let resolved = false;
        for (const adapter of context.adapters) {
            const result = adapter.resolveImportPath?.(imp.specifier, args.file, context);
            if (result) {
                const relativeResult = path.relative(root, result);
                console.log(`    ✅ ${adapter.name}: ${relativeResult}`);
                resolved = true;
                resolvedCount++;
                break;
            }
        }
        
        if (!resolved) {
            console.log(`    ❌ Unresolved`);
            
            // Diagnostic hints
            if (imp.specifier.startsWith('./') || imp.specifier.startsWith('../')) {
                const expectedPath = path.resolve(path.dirname(args.file), imp.specifier);
                console.log(`       Hint: Expected at ${path.relative(root, expectedPath)}*`);
                console.log(`       Check: Does the file exist with .ts/.tsx/.js extension?`);
            } else if (/^(app|src|config|types|lib|shared|common|utils|services|models|components|pages|api|db)\//.test(imp.specifier)) {
                const expectedPath = path.resolve(root, imp.specifier);
                console.log(`       Hint: Expected at ${path.relative(root, expectedPath)}*`);
                console.log(`       Check: Is --root correct? (current: ${root})`);
            }
            unresolvedCount++;
        }
        console.log();
    }
    
    console.log('--- Summary ---');
    console.log(`  Total Imports: ${imports.length}`);
    console.log(`  Resolved: ${resolvedCount} ✅`);
    console.log(`  Unresolved: ${unresolvedCount} ❌`);
    
    if (unresolvedCount > 0) {
        console.log('\n--- Troubleshooting ---');
        console.log('  1. Check if --root points to the correct project root');
        console.log('  2. Verify that imported files exist');
        console.log('  3. For "app/..." imports, ensure the project follows standard structure');
        console.log('  4. Try running with PMM_DEBUG=1 for more details');
    }
    
    console.log('\n=== Diagnosis Complete ===');
}

main();
