#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-chat';

function usage() {
  console.error('Usage: node application-package.mjs --id <tracker-id>');
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

function extractJdPathFromReport(reportText) {
  const patterns = [
    /来源JD[：:]\s*(.+)/,
    /鏉ユ簮JD[：:]\s*(.+)/,
    /Source JD[：:]\s*(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = reportText.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      const pending = join(ROOT, candidate);
      if (existsSync(pending)) return pending;
      const processed = join(ROOT, candidate.replace(/jds\/pending\//, 'jds/processed/'));
      if (existsSync(processed)) return processed;
      return pending;
    }
  }
  return null;
}

function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'application';
}

function outputDirFor(row) {
  const id = String(row.num).padStart(3, '0');
  return join(ROOT, 'output/applications', `${id}-${slugify(row.company)}`);
}

function stripFence(text) {
  const trimmed = String(text ?? '').trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function fallbackMessage(row) {
  const contact = String(row.contact ?? '').trim();
  if (contact) return contact;
  return `您好，我是软件工程本科在读，关注到贵公司的${row.role}岗位。我的方向是Java后端和AI应用开发，做过Spring Boot、FastAPI、数据库和Redis相关项目，希望了解这个实习岗位是否仍在招聘。`;
}

async function generateMessage({ row, reportText, jdText, cvText, contactoText }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.CAREER_OPS_MODEL || DEFAULT_MODEL;
  if (!apiKey) return { message: fallbackMessage(row), model: 'fallback:no-openrouter-key' };

  const prompt = `你是 career-ops 中国实习求职沟通助手。请根据 modes/contacto.md 的规则，为下面这个岗位生成一条可直接发送的中文沟通话术。

要求：
- 平台：${row.platform || '招聘平台未知'}
- 公司：${row.company}
- 岗位：${row.role}
- 投递建议：${row.recommendation || '未知'}
- 如果 Recommendation=不推荐，只生成岗位真实性确认问题，不生成正常求职开场白。
- 如果是推荐投递或谨慎投递，输出 100-150 字左右。
- 只输出最终话术正文，不要标题、解释、Markdown。
- 不要编造 cv.md 不存在的信息。

## modes/contacto.md
${contactoText}

## cv.md
${cvText}

## JD
${jdText || '未找到原始JD，使用岗位分析报告作为依据。'}

## Report
${reportText}`;

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/santifer/career-ops',
      'X-Title': 'career-ops-application-package',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: '你只输出一条中文招聘平台沟通话术。' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return { message: fallbackMessage(row), model: `fallback:http-${response.status}` };
  }
  const data = JSON.parse(body);
  const content = data?.choices?.[0]?.message?.content;
  return { message: stripFence(content || fallbackMessage(row)), model };
}

function shouldSkip(row) {
  if (String(row.recommendation ?? '').trim() === '不推荐') {
    return 'Recommendation=不推荐';
  }
  return null;
}

async function main() {
  loadEnv();
  const { id } = parseArgs(process.argv.slice(2));
  const row = findTrackerRow(id);
  const skipReason = shouldSkip(row);
  if (skipReason) {
    console.log(`Skipped tracker #${id}: ${skipReason}`);
    return;
  }

  const resumePath = join(ROOT, 'resumes/main.pdf');
  if (!existsSync(resumePath)) {
    throw new Error('Fixed resume not found: resumes/main.pdf');
  }

  const reportPath = resolveProjectPath(row.report);
  const reportText = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
  const jdPath = reportText ? extractJdPathFromReport(reportText) : null;
  const jdText = jdPath && existsSync(jdPath) ? readFileSync(jdPath, 'utf-8') : '';
  const cvText = readRequired('cv.md');
  const contactoText = readRequired('modes/contacto.md');

  const outDir = outputDirFor(row);
  mkdirSync(outDir, { recursive: true });

  const outResume = join(outDir, 'resume.pdf');
  copyFileSync(resumePath, outResume);

  const { message, model } = await generateMessage({
    row,
    reportText,
    jdText,
    cvText,
    contactoText,
  });

  const messagePath = join(outDir, 'message.md');
  writeFileSync(messagePath, `${message.trim()}\n`, 'utf-8');

  const metadata = {
    tracker_id: row.num,
    company: row.company,
    role: row.role,
    score100: row.score100 || row.score,
    recommendation: row.recommendation,
    report: reportPath ? reportPath.replace(/\\/g, '/') : '',
    jd: jdPath && existsSync(jdPath) ? jdPath.replace(/\\/g, '/') : '',
    resume_file: outResume.replace(/\\/g, '/'),
    message_file: messagePath.replace(/\\/g, '/'),
    message_model: model,
    created_at: new Date().toISOString(),
  };
  const metadataPath = join(outDir, 'metadata.json');
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');

  console.log('Application package created');
  console.log(`Output: ${outDir}`);
  console.log(`Resume: ${outResume}`);
  console.log(`Message: ${messagePath}`);
  console.log(`Metadata: ${metadataPath}`);
}

main().catch(err => {
  console.error(`application-package failed: ${err.message}`);
  process.exit(1);
});
