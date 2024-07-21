const fs = require('fs');
const path = require('path'); // 用于处理文件路径
const crypto = require('crypto'); // 用于生成哈希值
const recast = require('recast'); // 用于生成代码
const { parse } = require('@babel/parser');
const { parse: parseVue } = require('@vue/compiler-sfc'); // 用于解析 Vue 文件

// 解析文件，生成 AST
function parseFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf-8');
    return parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'decorators-legacy'],
        loc: true // 保留位置信息
    });
}

// 解析 Vue 文件，提取并解析其中的脚本部分
function parseVueFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { descriptor } = parseVue(content);
    if (descriptor.script || descriptor.scriptSetup) {
        const scriptContent = (descriptor.script && descriptor.script.content) || '';
        const scriptSetupContent = (descriptor.scriptSetup && descriptor.scriptSetup.content) || '';
        const code = scriptContent + '\n' + scriptSetupContent;
        return parse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'decorators-legacy'],
            loc: true // 保留位置信息
        });
    }
    return null;
}

// 提取 AST 中的函数声明和定义
function extractFunctions(ast, filePath) {
    const functions = [];
    traverse(ast, {
        enter: (node) => {
            // 函数声明或定义
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
                functions.push({ node, filePath });
            }
            // 类方法
            else if (node.type === 'ClassMethod') {
                functions.push({ node, filePath });
            }
            // 类属性，并且其值是函数表达式
            else if (node.type === 'ClassProperty' && node.value && node.value.type === 'FunctionExpression') {
                functions.push({ node: node.value, filePath });
            }
        }
    });
    return functions;
}

// 遍历 AST 节点的工具函数
function traverse(node, visitor) {
    visitor.enter(node);
    for (let key in node) {
        if (node[key] && typeof node[key] === 'object') {
            traverse(node[key], visitor);
        }
    }
    visitor.leave && visitor.leave(node);
}

// 规范化函数的代码，将所有标识符名替换为统一的名称，并去除注释和空白字符
function normalizeFunction(funcNode) {
    // 使用 recast 打印代码，并去除注释和空白字符
    const code = recast.print(funcNode).code;
    return code.replace(/\/\/.*|\/\*[\s\S]*?\*\/|\s+/g, '');
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
            if (!duplicates[hash]) {
                duplicates[hash] = [hashes[hash]];
            }
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

    for (let hash in duplicates) {
        const instances = duplicates[hash];
        if (instances.length >= minOccurrences) {
            const firstInstance = instances[0];
            const code = extractFunctionCode(firstInstance.filePath, firstInstance.node.loc);
            report += `发现重复函数（${instances.length} 次）：\n`;
            instances.forEach(instance => {
                report += `  文件: ${instance.filePath}, 行 ${instance.node.loc.start.line} - 行 ${instance.node.loc.end.line}\n`;
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
        const codeLines = [];

        // 添加函数起始行
        codeLines.push(lines[startLine].substring(startColumn));

        // 添加中间行
        for (let i = startLine + 1; i < endLine; i++) {
            codeLines.push(lines[i]);
        }

        // 添加函数结束行
        codeLines.push(lines[endLine].substring(0, endColumn));

        return codeLines.join('\n');
    }
}

function parseFileByExtension(filePath) {
    const ext = path.extname(filePath)
    if (ext === '.vue') {
        return parseVueFile(filePath);
    }
    return parseFile(filePathe)
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
            } else if (['.js','.ts','.vue'].includes(path.extname(file))) {
                const ast = parseFileByExtension(filePath);
                if (ast) {
                    const functions = extractFunctions(ast, filePath);
                    allFunctions.push(...functions);
                }
            }
        });
    }

    // 开始递归扫描
    scanDir(directory);

    // 查找重复函数并生成报告
    const duplicates = findDuplicateFunctions(allFunctions);
    generateReport(duplicates, outputFilePath, minOccurrences);
}

module.exports = scanProject;