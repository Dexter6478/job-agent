#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-chat';

function usage() {
  console.error('Usage: node interview-assistant.mjs --id <tracker-id>');
}

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const idIdx = argv.indexOf('--id');
  const unsupported = argv.filter(arg => arg.startsWith('--') && arg !== '--id');
  if (unsupported.length > 0 || idIdx === -1 || !argv[idIdx + 1]) {
    usage();
    process.exit(1);
  }
  const id = Number(argv[idIdx + 1]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('--id must be a positive tracker number.');
  }
  return { id };
}

function readRequired(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) throw new Error(`Required file not found: ${relPath}`);
  return readFileSync(abs, 'utf-8');
}

function trackerRows() {
  const trackerPath = join(ROOT, 'data/applications.md');
  if (!existsSync(trackerPath)) throw new Error('data/applications.md not found.');
  const lines = readFileSync(trackerPath, 'utf-8').split(/\r?\n/);
  const columns = resolveColumns(lines);
  return lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
}

function findTrackerRow(id) {
  const row = trackerRows().find(item => item.num === id);
  if (!row) throw new Error(`Tracker row #${id} not found in data/applications.md.`);
  return row;
}

function markdownLinkTarget(cell) {
  const text = String(cell ?? '').trim();
  const match = text.match(/\]\(([^)]+)\)/);
  return match ? match[1].trim() : text;
}

function resolveProjectPath(target, baseRel = 'data') {
  const raw = markdownLinkTarget(target);
  if (!raw || raw === '-') return null;
  const normalized = raw.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) return normalized;
  const fromData = resolve(join(ROOT, baseRel), normalized);
  if (existsSync(fromData)) return fromData;
  const fromRoot = resolve(ROOT, normalized);
  if (existsSync(fromRoot)) return fromRoot;
  return fromData;
}

function detectDirection(row, reportText) {
  const primary = `${row.role} ${row.resumeversion}`.toLowerCase();
  const text = `${primary} ${reportText}`.toLowerCase();
  if (/java|spring|后端|backend/.test(primary)) return 'Java后端';
  if (/ai|llm|rag|agent|prompt|fastapi|人工智能|大模型|ai应用/.test(primary)) return 'AI应用开发';
  if (/全栈|full.?stack/.test(primary)) return '全栈开发';
  if (/ai|llm|rag|agent|prompt|fastapi|人工智能|大模型/.test(text)) return 'AI应用开发';
  if (/java|spring|后端|backend/.test(text)) return 'Java后端';
  if (/全栈|vue|react native|typescript|frontend|前端/.test(text)) return '全栈开发';
  return 'Java后端';
}

function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'interview-prep';
}

function stripMarkdownFence(text) {
  const trimmed = String(text ?? '').trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function buildPrompt({ row, direction, cvText, profileText, modeText, reportText }) {
  return `你是 career-ops 中国软件工程本科实习面试助手。请严格基于 cv.md、profile.yml、modes/interview-prep.md 和岗位分析 report，生成一份中文面试准备文档。

硬性规则：
- 不编造 cv.md 不存在的经历、实习、奖项、证书或量化指标。
- 如果只是了解或学习过，不要写成熟练落地。
- 必须围绕两个真实项目生成回答：图书管理系统、Dietapp。
- 根据岗位方向侧重：${direction}。
- 输出 Markdown 正文，不要代码块，不要 JSON。

Tracker 岗位：
- 编号：${row.num}
- 公司：${row.company}
- 岗位：${row.role}
- 城市：${row.city || ''}
- 平台：${row.platform || ''}
- 状态：${row.status}
- 分数：${row.score100 || row.score || ''}
- 推荐：${row.recommendation || ''}

输出必须包含以下一级/二级结构：

# 面试准备：${row.company} - ${row.role}

## 一、岗位技术分析

## 二、可能面试问题

### Java方向

### AI方向

## 三、结合我的项目生成回答

### 图书管理系统

### Dietapp

## 四、面试前复习清单

必须覆盖的 Java 主题：
- Java基础
- 集合
- 线程
- Spring IOC/AOP
- 事务
- MySQL索引
- Redis缓存
- REST API
- 项目追问

如果岗位包含 AI/LLM/RAG/Agent/Prompt/FastAPI，必须覆盖：
- LLM调用
- Prompt设计
- RAG流程
- Embedding
- Agent工具调用
- AI安全

## modes/interview-prep.md
${modeText}

## cv.md
${cvText}

## config/profile.yml
${profileText}

## report
${reportText}`;
}

async function callOpenRouter(prompt, model, apiKey) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/santifer/career-ops',
      'X-Title': 'career-ops-interview-assistant',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: '你只输出中文 Markdown 面试准备文档。' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter request failed: HTTP ${response.status} ${body.slice(0, 500)}`);
  }
  const data = JSON.parse(body);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter response did not include message content.');
  return stripMarkdownFence(content);
}

async function main() {
  loadEnv();
  const { id } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.CAREER_OPS_MODEL || DEFAULT_MODEL;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required in .env or environment.');

  const row = findTrackerRow(id);
  const reportPath = resolveProjectPath(row.report);
  if (!reportPath || !existsSync(reportPath)) {
    throw new Error(`Report not found for tracker #${id}: ${row.report || '(empty)'}`);
  }

  const reportText = readFileSync(reportPath, 'utf-8');
  const cvText = readRequired('cv.md');
  const profileText = readRequired('config/profile.yml');
  const modeText = readRequired('modes/interview-prep.md');
  const direction = detectDirection(row, reportText);

  const prompt = buildPrompt({ row, direction, cvText, profileText, modeText, reportText });
  const markdown = await callOpenRouter(prompt, model, apiKey);

  const outDir = join(ROOT, 'interview-prep');
  mkdirSync(outDir, { recursive: true });
  const idPart = String(row.num).padStart(3, '0');
  const fileName = `${idPart}-${slugify(row.company)}-${slugify(row.role)}.md`;
  const outPath = join(outDir, fileName);
  writeFileSync(outPath, markdown.trim() + '\n', 'utf-8');

  console.log('Interview prep generated');
  console.log(`Model: ${model}`);
  console.log(`Tracker: #${row.num} ${row.company} - ${row.role}`);
  console.log(`Status: ${row.status}`);
  console.log(`Direction: ${direction}`);
  console.log(`Output: ${outPath}`);
}

main().catch(err => {
  console.error(`interview-assistant failed: ${err.message}`);
  process.exit(1);
});
