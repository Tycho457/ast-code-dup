const fs = require('fs');
const path = require('path'); // 用于处理文件路径
const crypto = require('crypto'); // 用于生成哈希值
const { parse } = require('@babel/parser');
const generate = require('@babel/generator').default;

// 解析文件，生成 AST
function parseFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf-8');
    return parse(code, {
        sourceType: 'module',
        attachComment: false,
        plugins: ['typescript', 'decorators-legacy'],
        loc: true // 保留位置信息
    });
}

// 提取 AST 中的函数声明和定义
function extractFunctions(ast, filePath) {
    const functions = [];
    traverse(ast, {
        enter: (node) => {
            // 函数声明、函数表达式或箭头函数
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassMethod'].includes(node.type)) {
                functions.push({ node, filePath });
            }
            // 类属性，并且其值是函数表达式
            else if (node.type === 'ClassProperty' && node.value?.type === 'FunctionExpression') {
                functions.push({ node: node.value, filePath });
            }
        }
    });
    return functions;
}

// 遍历 AST 节点的工具函数
function traverse(node, visitor) {
    visitor.enter(node);
    for (const key in node) {
        if (node[key] && typeof node[key] === 'object') {
            traverse(node[key], visitor);
        }
    }
    visitor.leave && visitor.leave(node);
}

// 规范化处理
function normalizeFunction(funcNode) {
    const { code } = generate(funcNode);
    return code.replace(/\s+/g, ''); // 去除空白字符
}

// 对规范化后的代码生成哈希值
function hashFunctionCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex'); // 使用 SHA-256 生成哈希值
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
    let report = '';

    for (const hash in duplicates) {
        const instances = duplicates[hash];
        if (instances.length >= minOccurrences) {
            const firstInstance = instances[0];
            const code = extractFunctionCode(firstInstance.filePath, firstInstance.node.loc);
            report += `发现重复函数（${instances.length} 次）：\n`;
            instances.forEach(({ filePath, node }) => {
                report += `  文件: ${filePath}, 行 ${node.loc.start.line} - 行 ${node.loc.end.line}\n`;
            });
            report += `代码片段:\n${code}\n\n`;
        }
    }

    fs.writeFileSync(outputFilePath, report, 'utf-8');
    console.log(`报告已生成: ${outputFilePath}`);
}

// 提取函数代码片段
function extractFunctionCode(filePath, loc) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const startLine = loc.start.line - 1;
    const endLine = loc.end.line - 1;
    const startColumn = loc.start.column - 1;
    const endColumn = loc.end.column;

    if (startLine === endLine) {
        return lines[startLine].substring(startColumn, endColumn);
    } else {
        const codeLines = [lines[startLine].substring(startColumn)];
        for (let i = startLine + 1; i < endLine; i++) {
            codeLines.push(lines[i]);
        }
        codeLines.push(lines[endLine].substring(0, endColumn));
        return codeLines.join('\n');
    }
}

// 递归扫描目录
function scanProject(directory, outputFilePath, minOccurrences = 3) {
    const allFunctions = [];

    function scanDir(dir) {
        const files = fs.readdirSync(dir);

        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                scanDir(filePath);
            } else if (['.js', '.ts'].includes(path.extname(file))) {
                const ast = parseFile(filePath);
                if (ast) {
                    const functions = extractFunctions(ast, filePath);
                    allFunctions.push(...functions);
                }
            }
        });
    }

    scanDir(directory);
    const duplicates = findDuplicateFunctions(allFunctions);
    generateReport(duplicates, outputFilePath, minOccurrences);
}

scanProject('example', 'report.txt', 3);
