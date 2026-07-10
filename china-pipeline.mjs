#!/usr/bin/env node
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-chat';
const VALID_STATUSES = new Set([
  'discovered',
  'evaluating',
  'recommended',
  'contacted',
  'hr_viewed',
  'applied',
  'screening',
  'test',
  'interview1',
  'interview2',
  'offer',
  'rejected',
  'withdrawn',
]);

const REQUIRED_CONTEXT = [
  'modes/zh/_shared.md',
  'modes/_profile.md',
  'config/profile.yml',
  'cv.md',
  'modes/zh/oferta.md',
  'modes/contacto.md',
];

const V2_TRACKER_COLUMNS = [
  '#',
  'date',
  'company',
  'role',
  'city',
  'platform',
  'url',
  'score',
  'score100',
  'resumeversion',
  'recommendation',
  'status',
  'contact',
  'nextaction',
  'report',
];

const LEGACY_TRACKER_COLUMNS = [
  '#',
  'date',
  'company',
  'role',
  'score',
  'status',
  'pdf',
  'report',
  'notes',
];

function usage() {
  console.error('Usage: node china-pipeline.mjs --file <jd-file>');
  console.error('   or: node china-pipeline.mjs --all');
}

function loadEnv() {
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) return;

  for (const line of readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
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
  const fileIdx = argv.indexOf('--file');
  const all = argv.includes('--all');
  const unsupported = argv.filter(arg => arg.startsWith('--') && arg !== '--file' && arg !== '--all');
  if (unsupported.length > 0 || (all && fileIdx !== -1) || (!all && (fileIdx === -1 || !argv[fileIdx + 1]))) {
    usage();
    process.exit(1);
  }
  return all ? { all: true } : { file: argv[fileIdx + 1] };
}

function readText(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) throw new Error(`Required file not found: ${relPath}`);
  return readFileSync(abs, 'utf-8');
}

function buildPrompt(contexts) {
  const schema = `{
  "analysis": {
    "company": "",
    "role": "",
    "city": "",
    "platform": "",
    "url": "",
    "score": 0,
    "score_breakdown": {
      "technical": 0,
      "project": 0,
      "quality": 0,
      "growth": 0,
      "condition": 0
    },
    "skill_confidence": {
      "explicit": [],
      "related": [],
      "missing": []
    },
    "strengths": [],
    "weaknesses": [],
    "risk": [],
    "recommendation": "",
    "resume_version": "",
    "contact_message": "",
    "interview_questions": []
  },
  "tracker": {
    "status": "",
    "next_action": ""
  }
}`;

  const contextBlock = contexts
    .map(({ relPath, content }) => `## ${relPath}\n\n${content}`)
    .join('\n\n---\n\n');

  return `你是 career-ops 中国互联网实习求职 Agent。

你必须只基于以下上下文和用户提供的 JD 进行分析。不得编造简历不存在的经历，不得把相关经验等同于熟练掌握。

必须使用这些中文上下文：
- modes/zh/_shared.md
- modes/_profile.md
- config/profile.yml
- cv.md
- modes/zh/oferta.md
- modes/contacto.md

禁止使用英文默认模式：
- modes/_shared.md
- modes/oferta.md

输出必须是严格 JSON，不要使用 Markdown，不要添加解释文本，不要包裹代码块。

JSON schema 必须完全匹配：
${schema}

字段规则：
- score 为 0-100 的整数。
- score_breakdown 使用中国实习评分体系：technical /40, project /25, quality /15, growth /10, condition /10。
- skill_confidence.explicit 表示 JD 明确要求且简历明确具备的技能。
- skill_confidence.related 表示相关但不能等同熟练的技能。
- skill_confidence.missing 表示 JD 要求但简历无法证明的技能。
- recommendation 只能表达为：推荐投递、谨慎投递、不推荐。
- resume_version 只能是：Java后端版、AI应用版、全栈版、无推荐简历版本。
- 若 recommendation 为 不推荐，resume_version 必须是 无推荐简历版本，contact_message 必须改为岗位真实性确认问题。
- tracker.status 必须是 canonical state 之一：recommended、evaluating、withdrawn。推荐投递用 recommended，谨慎投递用 evaluating，不推荐用 withdrawn。
- contact_message 面向 BOSS直聘/牛客/拉勾，100-150字左右；不推荐岗位只生成风险确认问题。

上下文如下：

${contextBlock}`;
}

function stripJsonFence(text) {
  let content = String(text ?? '').trim();
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) content = fenced[1].trim();
  return content;
}

function parseModelJson(text) {
  const direct = stripJsonFence(text);
  try {
    return JSON.parse(direct);
  } catch {
    const start = direct.indexOf('{');
    const end = direct.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(direct.slice(start, end + 1));
    }
    throw new Error('Model response was not valid JSON.');
  }
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value)];
}

function normalizeRecommendation(value, score) {
  const text = String(value ?? '').trim();
  if (['推荐投递', '谨慎投递', '不推荐'].includes(text)) return text;
  if (score >= 75) return '推荐投递';
  if (score >= 55) return '谨慎投递';
  return '不推荐';
}

function normalizeStatus(value, recommendation) {
  const raw = String(value ?? '').trim();
  if (VALID_STATUSES.has(raw)) return raw;
  if (recommendation === '推荐投递') return 'recommended';
  if (recommendation === '谨慎投递') return 'evaluating';
  return 'withdrawn';
}

function normalizeResumeVersion(value, recommendation) {
  if (recommendation === '不推荐') return '无推荐简历版本';
  const raw = String(value ?? '').trim();
  const allowed = new Set(['Java后端版', 'AI应用版', '全栈版', '无推荐简历版本']);
  return allowed.has(raw) ? raw : 'Java后端版';
}

function normalizePayload(payload) {
  const analysis = payload?.analysis ?? {};
  const score = clampScore(analysis.score);
  const recommendation = normalizeRecommendation(analysis.recommendation, score);
  const resumeVersion = normalizeResumeVersion(analysis.resume_version, recommendation);
  const status = normalizeStatus(payload?.tracker?.status, recommendation);

  return {
    analysis: {
      company: String(analysis.company ?? '').trim() || '未知公司',
      role: String(analysis.role ?? '').trim() || '未知岗位',
      city: String(analysis.city ?? '').trim() || '未知城市',
      platform: String(analysis.platform ?? '').trim() || '未知平台',
      url: String(analysis.url ?? '').trim(),
      score,
      score_breakdown: {
        technical: clampScore(analysis.score_breakdown?.technical),
        project: clampScore(analysis.score_breakdown?.project),
        quality: clampScore(analysis.score_breakdown?.quality),
        growth: clampScore(analysis.score_breakdown?.growth),
        condition: clampScore(analysis.score_breakdown?.condition),
      },
      skill_confidence: {
        explicit: asArray(analysis.skill_confidence?.explicit),
        related: asArray(analysis.skill_confidence?.related),
        missing: asArray(analysis.skill_confidence?.missing),
      },
      strengths: asArray(analysis.strengths),
      weaknesses: asArray(analysis.weaknesses),
      risk: asArray(analysis.risk),
      recommendation,
      resume_version: resumeVersion,
      contact_message: String(analysis.contact_message ?? '').trim(),
      interview_questions: asArray(analysis.interview_questions),
    },
    tracker: {
      status,
      next_action: String(payload?.tracker?.next_action ?? '').trim(),
    },
  };
}

async function callOpenRouter(systemPrompt, jdText, model, apiKey) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/santifer/career-ops',
      'X-Title': 'career-ops-china-pipeline',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请分析以下中国实习岗位 JD，并按指定 JSON schema 返回。\n\n${jdText}` },
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
  return content;
}

function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'china-jd';
}

function nextReportNumber() {
  const reportsDir = join(ROOT, 'reports');
  if (!existsSync(reportsDir)) return 1;
  const nums = readdirSync(reportsDir)
    .map(name => name.match(/^(\d+)-/))
    .filter(Boolean)
    .map(match => Number(match[1]))
    .filter(Number.isFinite);
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function list(items, empty = '无') {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : empty;
}

function renderReport(payload, meta) {
  const { analysis, tracker } = payload;
  return `# 中国JD分析：${analysis.company} - ${analysis.role}

生成日期：${meta.date}
模型：${meta.model}
来源JD：${meta.source}

## 基本信息

公司：${analysis.company}
岗位：${analysis.role}
城市：${analysis.city}
招聘平台：${analysis.platform}
JD链接：${analysis.url || '未提供'}

## 我的匹配评分

综合评分：${analysis.score}/100

| 维度 | 得分 |
|---|---:|
| 技术匹配 | ${analysis.score_breakdown.technical}/40 |
| 项目匹配 | ${analysis.score_breakdown.project}/25 |
| 岗位质量 | ${analysis.score_breakdown.quality}/15 |
| 成长空间 | ${analysis.score_breakdown.growth}/10 |
| 城市/实习条件 | ${analysis.score_breakdown.condition}/10 |

## 技能匹配置信度

### 明确匹配
${list(analysis.skill_confidence.explicit)}

### 相关匹配
${list(analysis.skill_confidence.related)}

### 未知缺失
${list(analysis.skill_confidence.missing)}

## 匹配优势
${list(analysis.strengths)}

## 技术短板
${list(analysis.weaknesses)}

## 风险判断
${list(analysis.risk)}

## 推荐简历版本

${analysis.resume_version}

## 投递建议

${analysis.recommendation}

## 沟通策略

${analysis.contact_message || '未生成'}

## 预计面试问题
${list(analysis.interview_questions)}

## Tracker

状态：${tracker.status}
下一步动作：${tracker.next_action || '未生成'}
`;
}

function sanitizeTsv(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function scoreToFive(score) {
  return `${(score / 20).toFixed(1)}/5`;
}

function normalizeHeaderName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function parseTrackerHeader(content) {
  const line = content
    .split(/\r?\n/)
    .find(candidate => candidate.startsWith('|') && /\bCompany\b/i.test(candidate) && /\bRole\b/i.test(candidate));
  if (!line) return [];
  return line
    .split('|')
    .map(normalizeHeaderName)
    .filter(Boolean);
}

function detectTrackerSchema(trackerPath) {
  if (!existsSync(trackerPath)) return 'v2';
  const headers = parseTrackerHeader(readFileSync(trackerPath, 'utf-8'));
  const hasAll = columns => columns.every(column => headers.includes(normalizeHeaderName(column)));
  if (hasAll(V2_TRACKER_COLUMNS)) return 'v2';
  if (hasAll(LEGACY_TRACKER_COLUMNS)) return 'legacy';
  console.warn(`WARNING: Unknown tracker schema in ${trackerPath}; falling back to legacy TSV output.`);
  return 'legacy';
}

function ensureTrackerExists() {
  const tracker = join(ROOT, 'data/applications.md');
  if (existsSync(tracker)) return tracker;
  mkdirSync(dirname(tracker), { recursive: true });
  writeFileSync(
    tracker,
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | City | Platform | URL | Score | Score100 | ResumeVersion | Recommendation | Status | Contact | NextAction | Report |',
      '|---|------|---------|------|------|----------|-----|-------|----------|---------------|----------------|--------|---------|------------|--------|',
      '',
    ].join('\n'),
    'utf-8',
  );
  return tracker;
}

function renderLegacyTrackerTsv(payload, num, date, reportLink) {
  const { analysis, tracker } = payload;
  const notes = [
    `city=${analysis.city}`,
    `platform=${analysis.platform}`,
    analysis.url ? `url=${analysis.url}` : '',
    `score=${analysis.score}/100`,
    `resume_version=${analysis.resume_version}`,
    `recommendation=${analysis.recommendation}`,
    tracker.next_action ? `next_action=${tracker.next_action}` : '',
  ].filter(Boolean).join('; ');

  return [
    num,
    date,
    analysis.company,
    analysis.role,
    tracker.status,
    scoreToFive(analysis.score),
    '-',
    reportLink,
    notes,
    analysis.city,
  ].map(sanitizeTsv).join('\t') + '\n';
}

function renderV2TrackerTsv(payload, num, date, reportLink) {
  const { analysis, tracker } = payload;
  return [
    num,
    date,
    analysis.company,
    analysis.role,
    analysis.city,
    analysis.platform,
    analysis.url,
    analysis.score,
    analysis.score,
    analysis.resume_version,
    analysis.recommendation,
    tracker.status,
    analysis.contact_message,
    tracker.next_action,
    reportLink,
  ].map(sanitizeTsv).join('\t') + '\n';
}

function renderTrackerTsv(payload, num, date, reportLink, schema) {
  return schema === 'v2'
    ? renderV2TrackerTsv(payload, num, date, reportLink)
    : renderLegacyTrackerTsv(payload, num, date, reportLink);
}

function normalizeKey(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function contentHash(text) {
  const normalized = String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

function extractField(text, label) {
  const re = new RegExp(`^${label}\\s*[：:]\\s*(.+?)\\s*$`, 'm');
  return text.match(re)?.[1]?.trim() || '';
}

function jdMetadata(text) {
  return {
    company: extractField(text, '公司'),
    role: extractField(text, '岗位'),
    url: extractField(text, 'JD链接'),
    hash: contentHash(text),
  };
}

function trackerRows() {
  const trackerPath = join(ROOT, 'data/applications.md');
  if (!existsSync(trackerPath)) return [];
  const content = readFileSync(trackerPath, 'utf-8');
  const header = content.split(/\r?\n/).find(line => line.startsWith('|') && /\bCompany\b/i.test(line) && /\bRole\b/i.test(line));
  if (!header) return [];
  const headers = header.split('|').map(h => normalizeHeaderName(h)).filter(Boolean);
  const idx = name => headers.indexOf(normalizeHeaderName(name));
  const indexes = {
    company: idx('company'),
    role: idx('role'),
    url: idx('url'),
    notes: idx('notes'),
  };
  return content.split(/\r?\n/)
    .filter(line => line.startsWith('|') && !line.includes('---') && !/\bCompany\b/i.test(line))
    .map(line => line.split('|').map(cell => cell.trim()).filter((_, i, arr) => !(i === 0 || i === arr.length - 1)))
    .filter(cells => cells.length > 0)
    .map(cells => ({
      company: indexes.company >= 0 ? cells[indexes.company] : '',
      role: indexes.role >= 0 ? cells[indexes.role] : '',
      url: indexes.url >= 0 ? cells[indexes.url] : '',
      notes: indexes.notes >= 0 ? cells[indexes.notes] : '',
    }));
}

function existingDedupIndex() {
  const urls = new Set();
  const roles = new Set();
  for (const row of trackerRows()) {
    if (row.url) urls.add(row.url.trim());
    const notesUrl = row.notes.match(/\burl=([^;]+)/i)?.[1]?.trim();
    if (notesUrl) urls.add(notesUrl);
    const roleKey = `${normalizeKey(row.company)}::${normalizeKey(row.role)}`;
    if (roleKey !== '::') roles.add(roleKey);
  }
  return { urls, roles };
}

function duplicateReason(meta, index, seenHashes) {
  if (meta.url && index.urls.has(meta.url)) return `URL already exists: ${meta.url}`;
  const roleKey = `${normalizeKey(meta.company)}::${normalizeKey(meta.role)}`;
  if (roleKey !== '::' && index.roles.has(roleKey)) return `company + role already exists: ${meta.company} / ${meta.role}`;
  if (seenHashes.has(meta.hash)) return `JD content hash already processed: ${meta.hash.slice(0, 12)}`;
  return null;
}

function pendingJdFiles() {
  const pendingDir = join(ROOT, 'jds/pending');
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir)
    .filter(name => name.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map(name => join(pendingDir, name));
}

function ensureJdLifecycleDirs() {
  for (const dir of ['jds/pending', 'jds/processed', 'jds/failed']) {
    mkdirSync(join(ROOT, dir), { recursive: true });
  }
}

function uniqueDestination(dir, filename) {
  let target = join(dir, filename);
  if (!existsSync(target)) return target;
  const dot = filename.lastIndexOf('.');
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  const ext = dot >= 0 ? filename.slice(dot) : '';
  target = join(dir, `${stem}-${Date.now()}${ext}`);
  let n = 2;
  while (existsSync(target)) {
    target = join(dir, `${stem}-${Date.now()}-${n}${ext}`);
    n++;
  }
  return target;
}

function moveJd(jdPath, state) {
  if (!jdPath.includes(`${join('jds', 'pending')}`) || !existsSync(jdPath)) return null;
  const targetDir = join(ROOT, 'jds', state);
  mkdirSync(targetDir, { recursive: true });
  const target = uniqueDestination(targetDir, basename(jdPath));
  renameSync(jdPath, target);
  return target;
}

function writeOutputs(payload, sourceFile, model) {
  const reportNum = nextReportNumber();
  const num = String(reportNum).padStart(3, '0');
  const date = today();
  const { analysis, tracker } = payload;
  const slug = slugify(`${analysis.company}-${analysis.role}`);
  const trackerPath = ensureTrackerExists();
  const trackerSchema = detectTrackerSchema(trackerPath);

  const reportsDir = join(ROOT, 'reports');
  const additionsDir = join(ROOT, 'batch/tracker-additions');
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(additionsDir, { recursive: true });

  const reportName = `${num}-${slug}-${date}.md`;
  const reportPath = join(reportsDir, reportName);
  const relSource = relative(ROOT, sourceFile).replace(/\\/g, '/');
  const report = renderReport(payload, {
    date,
    model,
    source: relSource,
  });
  writeFileSync(reportPath, report, 'utf-8');

  const reportLink = `[${num}](reports/${reportName})`;
  const tsvPath = join(additionsDir, `${num}-${slug}.tsv`);
  const tsv = renderTrackerTsv(payload, num, date, reportLink, trackerSchema);
  writeFileSync(tsvPath, tsv, 'utf-8');

  return { reportPath, tsvPath, trackerPath, trackerSchema };
}

function runMerge() {
  return execFileSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
}

async function processOne(jdPath, systemPrompt, model, apiKey) {
  if (!existsSync(jdPath)) throw new Error(`JD file not found: ${relative(ROOT, jdPath)}`);
  const jdText = readFileSync(jdPath, 'utf-8');
  const raw = await callOpenRouter(systemPrompt, jdText, model, apiKey);
  const payload = normalizePayload(parseModelJson(raw));
  const outputs = writeOutputs(payload, jdPath, model);
  return { payload, outputs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  ensureJdLifecycleDirs();

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.CAREER_OPS_MODEL || DEFAULT_MODEL;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required in .env or environment.');

  const contexts = REQUIRED_CONTEXT.map(relPath => ({ relPath, content: readText(relPath) }));
  const systemPrompt = buildPrompt(contexts);

  if (args.all) {
    const files = pendingJdFiles();
    if (files.length === 0) {
      console.log('No pending JD files found in jds/pending/*.md');
      return;
    }

    const results = [];
    const dedupIndex = existingDedupIndex();
    const seenHashes = new Set();
    for (let i = 0; i < files.length; i++) {
      const jdPath = files[i];
      const rel = relative(ROOT, jdPath).replace(/\\/g, '/');
      console.log(`Processing ${i + 1}/${files.length}: ${rel}`);
      try {
        const jdText = readFileSync(jdPath, 'utf-8');
        const meta = jdMetadata(jdText);
        const duplicate = duplicateReason(meta, dedupIndex, seenHashes);
        if (duplicate) {
          const movedTo = moveJd(jdPath, 'processed');
          results.push({ ok: false, duplicate: true, file: jdPath, reason: duplicate, movedTo });
          console.log(`  Duplicate detected: ${duplicate}`);
          continue;
        }
        const result = await processOne(jdPath, systemPrompt, model, apiKey);
        seenHashes.add(meta.hash);
        if (meta.url) dedupIndex.urls.add(meta.url);
        const roleKey = `${normalizeKey(result.payload.analysis.company || meta.company)}::${normalizeKey(result.payload.analysis.role || meta.role)}`;
        if (roleKey !== '::') dedupIndex.roles.add(roleKey);
        const movedTo = moveJd(jdPath, 'processed');
        results.push({ ok: true, file: jdPath, ...result });
        console.log(`  success: score=${result.payload.analysis.score}, recommendation=${result.payload.analysis.recommendation}`);
        if (movedTo) console.log(`  moved: ${relative(ROOT, movedTo).replace(/\\/g, '/')}`);
      } catch (err) {
        const movedTo = moveJd(jdPath, 'failed');
        results.push({ ok: false, file: jdPath, error: err.message, movedTo });
        console.error(`  failed: ${err.message}`);
        if (movedTo) console.error(`  moved: ${relative(ROOT, movedTo).replace(/\\/g, '/')}`);
      }
    }

    const mergeOutput = runMerge();
    const successes = results.filter(r => r.ok);
    const duplicates = results.filter(r => r.duplicate);
    const failures = results.filter(r => !r.ok && !r.duplicate);
    const avgScore = successes.length
      ? successes.reduce((sum, r) => sum + r.payload.analysis.score, 0) / successes.length
      : 0;
    const countRecommendation = pattern => successes.filter(r => r.payload.analysis.recommendation.includes(pattern)).length;

    console.log('\nChina pipeline --all completed');
    console.log(`Model: ${model}`);
    console.log(`Success: ${successes.length}`);
    console.log(`Failed: ${failures.length}`);
    console.log(`Duplicates skipped: ${duplicates.length}`);
    console.log(`Average Score100: ${successes.length ? avgScore.toFixed(1) : 'N/A'}`);
    console.log(`推荐投递: ${countRecommendation('推荐') - countRecommendation('不推荐')}`);
    console.log(`谨慎投递: ${countRecommendation('谨慎')}`);
    console.log(`不推荐: ${countRecommendation('不推荐')}`);
    if (failures.length > 0) {
      console.log('Failures:');
      for (const failure of failures) {
        console.log(`- ${relative(ROOT, failure.file).replace(/\\/g, '/')}: ${failure.error}`);
      }
    }
    if (duplicates.length > 0) {
      console.log('Duplicates:');
      for (const duplicate of duplicates) {
        console.log(`- ${relative(ROOT, duplicate.file).replace(/\\/g, '/')}: ${duplicate.reason}`);
      }
    }
    console.log(mergeOutput.trim());
    return;
  }

  const jdPath = join(ROOT, args.file);
  const { outputs } = await processOne(jdPath, systemPrompt, model, apiKey);
  const mergeOutput = runMerge();

  console.log(`China pipeline completed with model: ${model}`);
  console.log(`Report: ${outputs.reportPath}`);
  console.log(`Tracker TSV: ${outputs.tsvPath}`);
  console.log(`Tracker: ${outputs.trackerPath}`);
  console.log(`Tracker schema: ${outputs.trackerSchema}`);
  console.log(mergeOutput.trim());
}

main().catch(err => {
  console.error(`china-pipeline failed: ${err.message}`);
  process.exit(1);
});
