#!/usr/bin/env node
/**
 * 结构化语义摘要提取器
 * 
 * 将方法体解析为语义操作序列，而非文本截断
 * 支持操作: filter, map, condition, assignment, method_call, loop, return
 */

const fs = require('fs');
const path = require('path');

// TypeScript 运行时 - 优先使用技能自带的
let ts = null;

function loadSkillTypeScript() {
    const path = require('path');
    const candidates = [
        // 1. 技能自己的 node_modules
        path.resolve(__dirname, '..', 'node_modules', 'typescript'),
        // 2. 环境变量指定
        process.env.PMM_TYPESCRIPT_PATH,
        // 3. 全局 typescript
        'typescript',
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const runtime = require(candidate);
            if (runtime && typeof runtime.createSourceFile === 'function') {
                return runtime;
            }
        } catch {
            continue;
        }
    }
    return null;
}

function ensureTsRuntime() {
    if (!ts) {
        ts = loadSkillTypeScript();
        if (!ts) {
            throw new Error(
                'TypeScript runtime not found.\n' +
                'Please install typescript in skill directory:\n' +
                '  cd <skill-path> && npm install typescript'
            );
        }
    }
    return ts;
}

function setTypeScriptRuntime(runtime) {
    ts = runtime;
}

// ==================== 类型定义 ====================

/**
 * @typedef {Object} MethodSummary
 * @property {Object} location - 位置信息
 * @property {Object} meta - 元信息
 * @property {Object} summary - 结构化摘要
 */

/**
 * @typedef {Object} Operation
 * @property {string} type - 操作类型
 * @property {number} line - 行号
 */

// ==================== 主入口 ====================

/**
 * 提取方法的结构化语义摘要
 * @param {string} methodBody - 方法体源代码
 * @param {string} methodName - 方法名
 * @param {ts.SourceFile} sourceFile - TypeScript AST 源文件
 * @returns {Object} 结构化摘要
 */
function extractStructuredSummary(methodBody, methodName, sourceFile, tsRuntime = null) {
    if (!methodBody) {
        return createEmptySummary(methodName);
    }
    
    // 使用传入的 TS 运行时或尝试加载
    if (tsRuntime) {
        ts = tsRuntime;
    } else {
        ensureTsRuntime();
    }
    
    if (!sourceFile) {
        // 如果没有传入 sourceFile，创建一个临时的
        sourceFile = ts.createSourceFile(
            `${methodName}.ts`,
            methodBody,
            ts.ScriptTarget.Latest,
            true
        );
    }

    const summary = {
        complexity: 'low',
        branch_count: 0,
        loop_count: 0,
        call_count: 0,
        operations: [],
        data_flow: [],
        dependencies: []
    };

    // 遍历 AST 提取语义
    ts.forEachChild(sourceFile, function visit(node) {
        const operation = extractOperation(node, sourceFile);
        if (operation) {
            summary.operations.push(operation);
            
            // 更新统计
            if (operation.type === 'condition') summary.branch_count++;
            if (operation.type === 'loop') summary.loop_count++;
            if (operation.type === 'method_call') summary.call_count++;
            
            // 提取数据流
            const dataFlow = extractDataFlow(node, operation);
            if (dataFlow) {
                summary.data_flow.push(...dataFlow);
            }
        }
        
        ts.forEachChild(node, visit);
    });

    // 计算复杂度
    summary.complexity = calculateComplexity(summary);

    return summary;
}

// ==================== 操作提取 ====================

/**
 * 从 AST 节点提取操作
 */
function extractOperation(node, sourceFile) {
    switch (node.kind) {
        case ts.SyntaxKind.CallExpression:
            return extractCallOperation(node, sourceFile);
            
        case ts.SyntaxKind.IfStatement:
            return extractConditionOperation(node, sourceFile);
            
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.WhileStatement:
            return extractLoopOperation(node, sourceFile);
            
        case ts.SyntaxKind.VariableDeclaration:
        case ts.SyntaxKind.VariableStatement:
            return extractVariableOperation(node, sourceFile);
            
        case ts.SyntaxKind.ExpressionStatement:
            return extractExpressionOperation(node, sourceFile);
            
        case ts.SyntaxKind.ReturnStatement:
            return extractReturnOperation(node, sourceFile);
            
        default:
            return null;
    }
}

/**
 * 提取方法调用操作
 */
function extractCallOperation(node, sourceFile) {
    const expression = node.expression;
    let methodName = '';
    let target = '';
    
    if (ts.isPropertyAccessExpression(expression)) {
        // this.method() 或 obj.method()
        methodName = expression.name.text;
        target = expression.expression.getText(sourceFile);
    } else if (ts.isIdentifier(expression)) {
        // globalFunction()
        methodName = expression.text;
        target = 'global';
    }

    const args = node.arguments.map(arg => simplifyExpression(arg, sourceFile));
    
    // 识别特殊模式: filter, map, find, etc.
    if (isArrayMethod(methodName)) {
        return {
            type: methodName.toLowerCase(),
            target: target,
            method: methodName,
            condition: args[0] || '',
            line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1
        };
    }

    return {
        type: 'method_call',
        target: target,
        method: methodName,
        args: args,
        is_async: false, // TODO: detect async
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1
    };
}

/**
 * 提取条件操作
 */
function extractConditionOperation(node, sourceFile) {
    const condition = simplifyExpression(node.expression, sourceFile);
    const line = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
    
    // 检测是否是卫语句提前返回
    let isEarlyReturn = false;
    if (node.thenStatement) {
        // 直接返回: if (x) return;
        if (ts.isReturnStatement(node.thenStatement)) {
            isEarlyReturn = true;
        }
        // 块中返回: if (x) { return; }
        else if (ts.isBlock(node.thenStatement)) {
            const statements = node.thenStatement.statements;
            if (statements.length === 1 && ts.isReturnStatement(statements[0])) {
                isEarlyReturn = true;
            }
        }
    }

    return {
        type: 'condition',
        condition: condition,
        is_early_return: isEarlyReturn,
        line: line
    };
}

/**
 * 提取循环操作
 */
function extractLoopOperation(node, sourceFile) {
    const line = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
    let loopType = 'loop';
    let target = '';
    
    if (ts.isForOfStatement(node)) {
        loopType = 'for_of';
        target = simplifyExpression(node.expression, sourceFile);
    } else if (ts.isForInStatement(node)) {
        loopType = 'for_in';
        target = simplifyExpression(node.expression, sourceFile);
    } else if (ts.isForStatement(node)) {
        loopType = 'for';
    } else if (ts.isWhileStatement(node)) {
        loopType = 'while';
    }

    return {
        type: 'loop',
        loop_type: loopType,
        target: target,
        line: line
    };
}

/**
 * 提取变量声明操作
 */
function extractVariableOperation(node, sourceFile) {
    if (ts.isVariableStatement(node)) {
        const declarations = node.declarationList.declarations;
        const ops = [];
        
        for (const decl of declarations) {
            if (ts.isIdentifier(decl.name)) {
                const target = decl.name.text;
                const source = decl.initializer ? simplifyExpression(decl.initializer, sourceFile) : 'undefined';
                const hasFallback = decl.initializer && 
                    (ts.isBinaryExpression(decl.initializer) && 
                     decl.initializer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);
                
                ops.push({
                    type: 'assignment',
                    target: target,
                    source: source,
                    has_fallback: hasFallback,
                    line: ts.getLineAndCharacterOfPosition(sourceFile, decl.getStart()).line + 1
                });
            }
        }
        
        return ops.length === 1 ? ops[0] : { type: 'multi_assignment', operations: ops };
    }
    
    return null;
}

/**
 * 提取表达式操作
 */
function extractExpressionOperation(node, sourceFile) {
    const expr = node.expression;
    
    // 赋值表达式: this.x = y
    if (ts.isBinaryExpression(expr)) {
        if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            return {
                type: 'assignment',
                target: simplifyExpression(expr.left, sourceFile),
                source: simplifyExpression(expr.right, sourceFile),
                line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1
            };
        }
    }
    
    // 其他方法调用
    if (ts.isCallExpression(expr)) {
        return extractCallOperation(expr, sourceFile);
    }
    
    return null;
}

/**
 * 提取返回操作
 */
function extractReturnOperation(node, sourceFile) {
    return {
        type: 'return',
        value: node.expression ? simplifyExpression(node.expression, sourceFile) : undefined,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1
    };
}

// ==================== 表达式简化 ====================

/**
 * 简化表达式，保留语义去除语法噪音
 */
function simplifyExpression(node, sourceFile) {
    if (!node) return '';
    
    switch (node.kind) {
        case ts.SyntaxKind.Identifier:
            return node.text;
            
        case ts.SyntaxKind.PropertyAccessExpression:
            return simplifyPropertyAccess(node, sourceFile);
            
        case ts.SyntaxKind.ElementAccessExpression:
            return `${simplifyExpression(node.expression, sourceFile)}[${simplifyExpression(node.argumentExpression, sourceFile)}]`;
            
        case ts.SyntaxKind.BinaryExpression:
            const left = simplifyExpression(node.left, sourceFile);
            const right = simplifyExpression(node.right, sourceFile);
            const op = node.operatorToken.getText(sourceFile);
            return `${left} ${op} ${right}`;
            
        case ts.SyntaxKind.ConditionalExpression:
            const cond = simplifyExpression(node.condition, sourceFile);
            const whenTrue = simplifyExpression(node.whenTrue, sourceFile);
            const whenFalse = simplifyExpression(node.whenFalse, sourceFile);
            return `${cond} ? ${whenTrue} : ${whenFalse}`;
            
        case ts.SyntaxKind.CallExpression:
            const target = ts.isPropertyAccessExpression(node.expression)
                ? `${simplifyExpression(node.expression.expression, sourceFile)}.${node.expression.name.text}`
                : node.expression.text;
            const args = node.arguments.map(a => simplifyExpression(a, sourceFile)).join(', ');
            return `${target}(${args})`;
            
        case ts.SyntaxKind.ArrowFunction:
            const params = node.parameters.map(p => p.name.getText(sourceFile)).join(', ');
            const body = node.body ? simplifyExpression(node.body, sourceFile) : '';
            return `(${params}) => ${body}`;
            
        case ts.SyntaxKind.Block:
            // 简化代码块，保留关键逻辑
            return '{ ... }';
            
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NumericLiteral:
        case ts.SyntaxKind.TrueKeyword:
        case ts.SyntaxKind.FalseKeyword:
        case ts.SyntaxKind.NullKeyword:
        case ts.SyntaxKind.UndefinedKeyword:
            return node.getText(sourceFile);
            
        case ts.SyntaxKind.ArrayLiteralExpression:
            return '[]';
            
        case ts.SyntaxKind.ObjectLiteralExpression:
            return '{}';
            
        default:
            // 对于复杂表达式，返回简化形式
            const text = node.getText(sourceFile);
            if (text.length > 50) {
                return text.slice(0, 47) + '...';
            }
            return text;
    }
}

function simplifyPropertyAccess(node, sourceFile) {
    const parts = [];
    let current = node;
    
    while (current) {
        if (ts.isIdentifier(current)) {
            parts.unshift(current.text);
            break;
        } else if (ts.isPropertyAccessExpression(current)) {
            parts.unshift(current.name.text);
            current = current.expression;
        } else if (ts.isThisExpression(current)) {
            parts.unshift('this');
            break;
        } else {
            parts.unshift(current.getText(sourceFile));
            break;
        }
    }
    
    return parts.join('.');
}

// ==================== 辅助函数 ====================

/**
 * 检查是否是数组方法
 */
function isArrayMethod(name) {
    const arrayMethods = ['filter', 'map', 'reduce', 'find', 'some', 'every', 'forEach', 'sort'];
    return arrayMethods.includes(name.toLowerCase());
}

/**
 * 提取数据流
 */
function extractDataFlow(node, operation) {
    const flows = [];
    
    if (operation.type === 'filter') {
        // filter: target -> target (transform)
        flows.push({
            from: operation.target,
            to: operation.target,
            stage: 'filter',
            operation: 'filter'
        });
    } else if (operation.type === 'assignment') {
        // assignment: source -> target
        flows.push({
            from: operation.source,
            to: operation.target,
            stage: 'transform'
        });
    }
    
    return flows;
}

/**
 * 计算复杂度
 */
function calculateComplexity(summary) {
    const score = summary.branch_count + summary.loop_count * 2 + summary.call_count * 0.5;
    
    if (score <= 2) return 'low';
    if (score <= 5) return 'medium';
    return 'high';
}

/**
 * 创建空摘要
 */
function createEmptySummary(methodName) {
    return {
        complexity: 'low',
        branch_count: 0,
        loop_count: 0,
        call_count: 0,
        operations: [],
        data_flow: [],
        dependencies: []
    };
}

// ==================== 命令行接口 ====================

function parseArgs(argv) {
    const args = { code: '', method: '', file: '' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--code' && i + 1 < argv.length) {
            args.code = argv[++i];
        } else if (argv[i] === '--method' && i + 1 < argv.length) {
            args.method = argv[++i];
        } else if (argv[i] === '--file' && i + 1 < argv.length) {
            args.file = argv[++i];
        }
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    
    if (!args.code && !args.file) {
        console.log('Usage: node extract_structured_summary.js --code "<method-body>" --method <name>');
        console.log('       node extract_structured_summary.js --file <path> --method <name>');
        process.exit(1);
    }
    
    // 确保 TypeScript 运行时已加载
    ensureTsRuntime();
    
    const code = args.file 
        ? fs.readFileSync(args.file, 'utf8')
        : args.code;
    
    const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
    );
    
    const summary = extractStructuredSummary(code, args.method || 'anonymous', sourceFile);
    console.log(JSON.stringify(summary, null, 2));
}

// ==================== 模块导出 ====================

module.exports = {
    extractStructuredSummary,
    simplifyExpression,
    calculateComplexity,
    setTypeScriptRuntime
};

if (require.main === module) {
    main();
}
