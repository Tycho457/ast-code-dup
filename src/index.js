const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('@babel/parser');
const generate = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

// 解析文件，生成 AST
function parseFile(filePath) {
    return parse(fs.readFileSync(filePath, 'utf-8'), {
        sourceType: 'module',
        attachComment: false,
        plugins: ['typescript', 'decorators-legacy'],
        loc: true
    });
}

// 提取 AST 中的函数声明和定义
function extractFunctions(ast, filePath) {
    const functions = [];
    traverse(ast, {
        'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod'(path) {
            functions.push({ node: path.node, filePath });
        },
        ClassProperty(path) {
            if (t.isFunctionExpression(path.node.value)) {
                functions.push({ node: path.node.value, filePath });
            }
        }
    });
    return functions;
}

// 标准化标识符
function standardizeIdentifiers(ast) {
    let identifierCount = 0;
    const identifierMap = new Map();

    traverse(ast, {
        Identifier(path) {
            if (!identifierMap.has(path.node.name)) {
                identifierMap.set(path.node.name, `identifier_${identifierCount++}`);
            }
            path.node.name = identifierMap.get(path.node.name);
        }
    });
}

// 规范化函数的代码，将所有标识符名替换为统一的名称，并去除空白字符
function normalizeFunction(funcNode) {
    const wrappedNode = t.expressionStatement(
      t.isFunctionDeclaration(funcNode)
        ? t.functionExpression(null, funcNode.params, funcNode.body)
        : funcNode
    );

    const funcAst = t.file(t.program([wrappedNode]));
    standardizeIdentifiers(funcAst);

    const { code } = generate(funcAst);
    return code.replace(/\s+/g, '');
}

// 对规范化后的代码生成哈希值
function hashFunctionCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

// 查找重复的函数
function findDuplicateFunctions(functions) {
    const hashes = {};
    const duplicates = {};

    functions.forEach(({ node, filePath }) => {
        const normalizedCode = normalizeFunction(node);
        const hash = hashFunctionCode(normalizedCode);

        if (hashes[hash]) {
            duplicates[hash] = duplicates[hash] || [hashes[hash]];
            duplicates[hash].push({ node, filePath });
        } else {
            hashes[hash] = { node, filePath };
        }
    });

    return duplicates;
}

// 生成报告并写入文件
function generateReport(duplicates, outputFilePath, minOccurrences = 3) {
    const reportLines = [];

    for (const hash in duplicates) {
        const instances = duplicates[hash];
        if (instances.length >= minOccurrences) {
            const firstInstance = instances[0];
            const code = extractFunctionCode(firstInstance.filePath, firstInstance.node.loc);
            reportLines.push(`发现重复函数（${instances.length} 次）：\n`);
            instances.forEach(({ filePath, node }) => {
                reportLines.push(`  文件: ${filePath}, 行 ${node.loc.start.line} - 行 ${node.loc.end.line}\n`);
            });
            reportLines.push(`代码片段:\n${code}\n\n`);
        }
    }

    fs.writeFileSync(outputFilePath, reportLines.join(''), 'utf-8');
    console.log(`报告已生成: ${outputFilePath}`);
}

// 提取函数代码片段
function extractFunctionCode(filePath, loc) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const { start, end } = loc;

    if (start.line === end.line) {
        return lines[start.line - 1].substring(start.column, end.column);
    }

    const codeLines = [lines[start.line - 1].substring(start.column)];
    for (let i = start.line; i < end.line - 1; i++) {
        codeLines.push(lines[i]);
    }
    codeLines.push(lines[end.line - 1].substring(0, end.column));

    return codeLines.join('\n');
}

// 递归扫描目录
function scanProject(directory, outputFilePath, minOccurrences = 3) {
    const allFunctions = [];

    function scanDir(dir) {
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                scanDir(filePath);
            } else if (['.js', '.ts'].includes(path.extname(file))) {
                const ast = parseFile(filePath);
                const functions = extractFunctions(ast, filePath);
                allFunctions.push(...functions);
            }
        });
    }

    scanDir(directory);
    const duplicates = findDuplicateFunctions(allFunctions);
    generateReport(duplicates, outputFilePath, minOccurrences);
}

scanProject('example', 'report.txt', 2);
