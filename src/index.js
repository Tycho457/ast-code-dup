const esprima = require('esprima'); // 用于解析 JavaScript 代码生成 AST
const fs = require('fs'); // 用于文件操作
const path = require('path'); // 用于处理文件路径
const crypto = require('crypto'); // 用于生成哈希值
const escodegen = require('escodegen');

// 解析文件，生成 AST
function parseFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf-8');
    return esprima.parseScript(code, { loc: true }); // loc: true 保留位置信息
}

// 提取 AST 中的函数声明和定义
function extractFunctions(ast, filePath) {
    const functions = [];
    traverse(ast, {
        enter: (node) => {
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
                functions.push({ node, filePath });
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

// 规范化函数的代码，将所有标识符名替换为统一的名称
function normalizeFunction(funcNode) {
  const identifierMap = new Map();
  let counter = 0;

  traverse(funcNode, {
      enter(node) {
          if (node.type === 'Identifier') {
              if (!identifierMap.has(node.name)) {
                  identifierMap.set(node.name, `normalized_${counter++}`);
              }
              node.name = identifierMap.get(node.name);
          }
      }
  });

  return escodegen.generate(funcNode);
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

// 生成报告
function generateReport(duplicates) {
  for (let hash in duplicates) {
      const instances = duplicates[hash];
      const firstInstance = instances[0];
      const code = extractFunctionCode(firstInstance.filePath, firstInstance.node.loc);
      console.log(`发现重复函数（${instances.length} 次）：`);
      instances.forEach(instance => {
          console.log(`  文件: ${instance.filePath}, 行 ${instance.node.loc.start.line} - 行 ${instance.node.loc.end.line}`);
      });
      console.log(`代码片段:\n${code}\n`);
      console.log();
  }
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

// 递归扫描目录
function scanProject(directory) {
  const allFunctions = [];

  function scanDir(dir) {
      const files = fs.readdirSync(dir);

      files.forEach(file => {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
              // 如果是目录，则递归扫描子目录
              scanDir(filePath);
          } else if (path.extname(file) === '.js') {
              // 如果是 JavaScript 文件，则解析并提取函数
              const ast = parseFile(filePath);
              const functions = extractFunctions(ast, filePath);
              allFunctions.push(...functions);
          }
      });
  }

  // 开始递归扫描
  scanDir(directory);

  // 查找重复函数并生成报告
  const duplicates = findDuplicateFunctions(allFunctions);
  generateReport(duplicates);
}

// 替换为你的项目路径
scanProject('example');