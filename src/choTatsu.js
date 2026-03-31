import fs from "fs/promises";
import { chromium } from "playwright";

const BASE_URL = "https://cho-tatsu.com";
const LOGIN_URL = `${BASE_URL}/login`;
const PROJECTS_URL = `${BASE_URL}/partners/projects`;
const TALENTS_URL = `${BASE_URL}/partners/talents`;

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

async function ensureArtifactsDir() {
  await fs.mkdir("artifacts", { recursive: true });
}

async function saveDebug(page, name) {
  await ensureArtifactsDir();
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
  await fs.writeFile(`artifacts/${name}.html`, await page.content(), "utf8");
}

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', process.env.CHO_TATSU_EMAIL);
  await page.fill('input[name="password"]', process.env.CHO_TATSU_PASSWORD);

  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }),
    page.locator('button[type="submit"]').click({ timeout: 10000 })
  ]);

  await page.waitForTimeout(5000);
  if (page.url().includes('/login')) {
    await saveDebug(page, 'login_failed');
    throw new Error('ログインに失敗しました。artifacts/login_failed.* を確認してください');
  }
}

async function exhaustPage(page) {
  let previousHeight = -1;
  for (let i = 0; i < 20; i++) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === previousHeight) break;
    previousHeight = height;
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(1200);
  }

  for (let i = 0; i < 10; i++) {
    const nextButton = page.locator('button:has-text("次へ"), a:has-text("次へ"), button[aria-label*="次"], a[aria-label*="次"]');
    if (await nextButton.count()) {
      const disabled = await nextButton.first().isDisabled().catch(() => false);
      if (disabled) break;
      await Promise.allSettled([
        page.waitForLoadState('networkidle', { timeout: 15000 }),
        nextButton.first().click({ timeout: 5000 })
      ]);
      await page.waitForTimeout(1500);
      continue;
    }
    break;
  }
}

async function collectRawItems(page, dataType) {
  const rawItems = await page.locator('a, article, li, div').evaluateAll((nodes, dataType) => {
    const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    const patterns = dataType === 'project'
      ? [/案件/, /単価/, /勤務地/, /スキル/, /商流/, /開始/, /稼働/]
      : [/人材/, /希望単価/, /単価/, /勤務地/, /スキル/, /稼働/, /所属/, /開始/];

    const items = [];
    for (const node of nodes) {
      const text = clean(node.innerText || '');
      if (!text || text.length < 20) continue;
      if (!patterns.some((p) => p.test(text))) continue;
      const href = node.href || node.closest('a')?.href || '';
      items.push({ href, text });
    }

    const seen = new Set();
    const unique = [];
    for (const item of items) {
      const key = `${item.href}__${item.text.slice(0, 160)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }, dataType);

  return rawItems;
}

function matchValue(text, labels) {
  for (const label of labels) {
    const regex = new RegExp(`${label}[:：]?\\s*([^\\n]+)`);
    const hit = text.match(regex);
    if (hit) return clean(hit[1]);
  }
  return '';
}

function guessTitle(lines, excludes = []) {
  return lines.find(line => !excludes.some(ex => line.includes(ex)) && line.length >= 2) || '';
}

function parseProject(item) {
  const text = clean(item.text);
  const lines = item.text.split(/\n+/).map(clean).filter(Boolean);
  return {
    captured_at: new Date().toISOString(),
    title: guessTitle(lines, ['単価', '勤務地', 'スキル', '商流', '開始', '稼働']),
    unit_price: matchValue(item.text, ['単価']),
    location: matchValue(item.text, ['勤務地', '場所']),
    skill: matchValue(item.text, ['スキル', '必須スキル']),
    must_skill: matchValue(item.text, ['必須スキル']),
    want_skill: matchValue(item.text, ['尚可スキル']),
    commercial_flow: matchValue(item.text, ['商流']),
    start_date: matchValue(item.text, ['開始時期', '開始', '参画時期']),
    utilization: matchValue(item.text, ['稼働率', '稼働']),
    period: matchValue(item.text, ['期間']),
    settlement: matchValue(item.text, ['精算']),
    interview_count: matchValue(item.text, ['面談']),
    age: matchValue(item.text, ['年齢']),
    nationality: matchValue(item.text, ['国籍']),
    headcount: matchValue(item.text, ['募集人数']),
    remote: matchValue(item.text, ['リモート']),
    note: matchValue(item.text, ['備考']),
    raw_text: text,
    url: item.href || '',
    unique_key: item.href || text.slice(0, 200)
  };
}

function parseTalent(item) {
  const text = clean(item.text);
  const lines = item.text.split(/\n+/).map(clean).filter(Boolean);
  return {
    captured_at: new Date().toISOString(),
    name: guessTitle(lines, ['単価', '希望単価', '勤務地', 'スキル', '稼働', '所属', '開始']),
    desired_unit_price: matchValue(item.text, ['希望単価', '単価']),
    location: matchValue(item.text, ['勤務地', '場所']),
    skill: matchValue(item.text, ['スキル']),
    utilization: matchValue(item.text, ['稼働率', '稼働']),
    available_from: matchValue(item.text, ['開始可能時期', '参画可能時期', '開始']),
    affiliation: matchValue(item.text, ['所属']),
    age: matchValue(item.text, ['年齢']),
    gender: matchValue(item.text, ['性別']),
    nationality: matchValue(item.text, ['国籍']),
    nearest_station: matchValue(item.text, ['最寄駅']),
    remote: matchValue(item.text, ['リモート']),
    note: matchValue(item.text, ['備考']),
    raw_text: text,
    url: item.href || '',
    unique_key: item.href || text.slice(0, 200)
  };
}

export async function scrapeChoTatsu() {
  await ensureArtifactsDir();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });

  try {
    await login(page);

    await page.goto(PROJECTS_URL, { waitUntil: 'domcontentloaded' });
    await exhaustPage(page);
    await saveDebug(page, 'projects_page');
    const projects = (await collectRawItems(page, 'project')).map(parseProject);

    await page.goto(TALENTS_URL, { waitUntil: 'domcontentloaded' });
    await exhaustPage(page);
    await saveDebug(page, 'talents_page');
    const talents = (await collectRawItems(page, 'talent')).map(parseTalent);

    if (!projects.length && !talents.length) {
      throw new Error('案件・人材ともに0件でした。セレクタ調整が必要です');
    }

    return { projects, talents };
  } catch (error) {
    await saveDebug(page, 'fatal_error');
    throw error;
  } finally {
    await browser.close();
  }
}
