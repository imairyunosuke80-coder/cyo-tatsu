import fs from "fs/promises";
import { chromium } from "playwright";

const BASE_URL = "https://cho-tatsu.com";
const LOGIN_URL = `${BASE_URL}/login`;
const PROJECTS_URL = `${BASE_URL}/partners/projects`;
const TALENTS_URL = `${BASE_URL}/partners/talents`;

function clean(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function preserveMultiline(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickFirstNonEmpty(...values) {
  return values.find((v) => clean(v)) || "";
}

function normalizePriceToMan(text) {
  const value = clean(text);
  if (!value) return "";

  return value
    .replace(/月額/g, "")
    .replace(/税込/g, "")
    .replace(/税抜/g, "")
    .replace(/万円/g, "")
    .replace(/万\/月/g, "")
    .replace(/万/g, "")
    .replace(/円/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function extractPrefecture(text) {
  const value = clean(text);
  if (!value) return "";

  const prefectures = [
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
    "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
    "新潟県","富山県","石川県","福井県","山梨県","長野県",
    "岐阜県","静岡県","愛知県","三重県",
    "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
    "鳥取県","島根県","岡山県","広島県","山口県",
    "徳島県","香川県","愛媛県","高知県",
    "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ];

  return prefectures.find((p) => value.includes(p)) || value;
}

function matchValue(text, labels) {
  const source = preserveMultiline(text);
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]\\s*([^\\n]+)`, "i"),
      new RegExp(`(?:^|\\n)\\s*${escaped}\\s*(?:\\n)+\\s*([^\\n]+)`, "i"),
      new RegExp(`${escaped}\\s*[:：]?\\s*([^\\n]+)`, "i"),
    ];

    for (const regex of patterns) {
      const hit = source.match(regex);
      if (hit?.[1]) {
        return clean(hit[1]);
      }
    }
  }
  return "";
}

function isMetaLine(line) {
  return /^(会社名|社名|企業名|クライアント|優先度|単価|希望単価|金額|月額|勤務地|都道府県|スキル|必須スキル|尚可スキル|職種|ポジション|募集職種|希望職種|年齢|年齢制限|リモート|リモート条件|商流|商流制限|個人事業主|外国籍|国籍|開始時期|開始可能時期|参画可能時期|最寄駅|所属|備考|案件情報|人材情報)/.test(line);
}

function guessTitle(lines, fallback = "") {
  const found = lines.find((line) => line.length >= 2 && !isMetaLine(line));
  return found || fallback || "";
}

function parseProjectText({ text, url = "", h1 = "", snippet = "" }) {
  const prettyText = preserveMultiline(text || snippet);
  const lines = prettyText.split("\n").map(clean).filter(Boolean);

  const location = pickFirstNonEmpty(
    matchValue(prettyText, ["勤務地", "場所", "勤務場所"]),
    matchValue(prettyText, ["都道府県"])
  );

  const rawPrice = pickFirstNonEmpty(
    matchValue(prettyText, ["単価", "単金", "金額", "月額"]),
    matchValue(prettyText, ["予算"])
  );

  const title = pickFirstNonEmpty(
    h1,
    matchValue(prettyText, ["案件タイトル", "案件名", "タイトル"]),
    guessTitle(lines, snippet)
  );

  return {
    captured_at: new Date().toISOString(),
    project_title: title,
    title,
    company_name: matchValue(prettyText, ["会社名", "社名", "企業名", "クライアント", "元請"]),
    priority: matchValue(prettyText, ["優先度"]),
    unit_price: rawPrice,
    price_man: normalizePriceToMan(rawPrice),
    job_type: matchValue(prettyText, ["職種", "ポジション", "募集職種"]),
    skill: pickFirstNonEmpty(
      matchValue(prettyText, ["スキル", "必須スキル"]),
      matchValue(prettyText, ["言語", "環境"])
    ),
    must_skill: matchValue(prettyText, ["必須スキル"]),
    want_skill: matchValue(prettyText, ["尚可スキル"]),
    age_limit: pickFirstNonEmpty(
      matchValue(prettyText, ["年齢制限"]),
      matchValue(prettyText, ["年齢"])
    ),
    remote: matchValue(prettyText, ["リモート", "リモート条件"]),
    remote_condition: matchValue(prettyText, ["リモート条件", "リモート"]),
    commercial_flow: matchValue(prettyText, ["商流"]),
    commercial_flow_limit: pickFirstNonEmpty(
      matchValue(prettyText, ["商流制限"]),
      matchValue(prettyText, ["商流"])
    ),
    sole_proprietor: matchValue(prettyText, ["個人事業主", "個人可", "個人事業主可否"]),
    nationality: matchValue(prettyText, ["国籍"]),
    foreign_nationality: pickFirstNonEmpty(
      matchValue(prettyText, ["外国籍", "外国籍可否"]),
      matchValue(prettyText, ["国籍"])
    ),
    location,
    prefecture: extractPrefecture(location),
    start_date: pickFirstNonEmpty(
      matchValue(prettyText, ["開始時期", "参画時期", "開始日"]),
      matchValue(prettyText, ["開始"])
    ),
    project_info: prettyText,
    raw_text: prettyText,
    url,
    unique_key: url || `${title}__${prettyText.slice(0, 180)}`
  };
}

function parseTalentText({ text, url = "", h1 = "", snippet = "" }) {
  const prettyText = preserveMultiline(text || snippet);
  const lines = prettyText.split("\n").map(clean).filter(Boolean);

  const location = pickFirstNonEmpty(
    matchValue(prettyText, ["勤務地", "場所", "勤務場所"]),
    matchValue(prettyText, ["都道府県"])
  );

  const rawPrice = pickFirstNonEmpty(
    matchValue(prettyText, ["希望単価", "単価", "単金", "金額", "月額"]),
    matchValue(prettyText, ["予算"])
  );

  const title = pickFirstNonEmpty(
    h1,
    matchValue(prettyText, ["人材タイトル", "人材名", "氏名", "タイトル"]),
    guessTitle(lines, snippet)
  );

  return {
    captured_at: new Date().toISOString(),
    talent_title: title,
    name: title,
    company_name: matchValue(prettyText, ["会社名", "社名", "企業名"]),
    priority: matchValue(prettyText, ["優先度"]),
    desired_unit_price: rawPrice,
    price_man: normalizePriceToMan(rawPrice),
    age: matchValue(prettyText, ["年齢"]),
    affiliation: matchValue(prettyText, ["所属"]),
    job_type: matchValue(prettyText, ["職種", "ポジション", "希望職種"]),
    skill: pickFirstNonEmpty(
      matchValue(prettyText, ["スキル"]),
      matchValue(prettyText, ["言語", "環境"])
    ),
    remote: matchValue(prettyText, ["リモート", "リモート条件"]),
    remote_condition: pickFirstNonEmpty(
      matchValue(prettyText, ["リモート条件"]),
      matchValue(prettyText, ["リモート"])
    ),
    nationality: pickFirstNonEmpty(
      matchValue(prettyText, ["国籍"]),
      matchValue(prettyText, ["外国籍"])
    ),
    location,
    prefecture: extractPrefecture(location),
    nearest_station: matchValue(prettyText, ["最寄駅"]),
    utilization: matchValue(prettyText, ["稼働率", "稼働"]),
    available_from: pickFirstNonEmpty(
      matchValue(prettyText, ["開始可能時期", "参画可能時期", "開始時期"]),
      matchValue(prettyText, ["開始"])
    ),
    start_date: pickFirstNonEmpty(
      matchValue(prettyText, ["開始可能時期", "参画可能時期", "開始時期"]),
      matchValue(prettyText, ["開始"])
    ),
    talent_info: prettyText,
    raw_text: prettyText,
    url,
    unique_key: url || `${title}__${prettyText.slice(0, 180)}`
  };
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

  await page.waitForSelector('input[name="email"]', { timeout: 20000 });
  await page.waitForSelector('input[name="password"]', { timeout: 20000 });

  await page.locator('input[name="email"]').click();
  await page.locator('input[name="email"]').fill("");
  await page.locator('input[name="email"]').type(process.env.CHO_TATSU_EMAIL, { delay: 60 });

  await page.locator('input[name="password"]').click();
  await page.locator('input[name="password"]').fill("");
  await page.locator('input[name="password"]').type(process.env.CHO_TATSU_PASSWORD, { delay: 80 });

  const submit = page.locator('button[type="submit"]');

  await Promise.allSettled([
    page.waitForLoadState("networkidle", { timeout: 20000 }),
    submit.click({ timeout: 10000 })
  ]);

  const loginSuccess = await Promise.race([
    page.waitForURL((url) => !url.toString().includes("/login"), { timeout: 15000 }).then(() => true).catch(() => false),
    page.locator("text=案件").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false),
  ]);

  await page.waitForTimeout(2500);

  if (!loginSuccess || page.url().includes("/login")) {
    await saveDebug(page, "login_failed");
    throw new Error("ログインに失敗しました。artifacts/login_failed.* を確認してください");
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
    const nextButton = page.locator(
      'button:has-text("次へ"), a:has-text("次へ"), button[aria-label*="次"], a[aria-label*="次"]'
    );

    if (await nextButton.count()) {
      const disabled = await nextButton.first().isDisabled().catch(() => false);
      if (disabled) break;

      await Promise.allSettled([
        page.waitForLoadState("networkidle", { timeout: 15000 }),
        nextButton.first().click({ timeout: 5000 })
      ]);

      await page.waitForTimeout(1500);
      continue;
    }

    break;
  }
}

async function collectDetailCandidates(page, dataType) {
  const pathPrefix = dataType === "project" ? "/partners/projects/" : "/partners/talents/";

  const candidates = await page.locator("a[href]").evaluateAll((anchors, pathPrefix) => {
    const clean = (text) => String(text || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

    const items = [];
    for (const a of anchors) {
      const href = a.href || "";
      if (!href.includes(pathPrefix)) continue;

      const path = new URL(href).pathname;
      if (path === pathPrefix.replace(/\/$/, "")) continue;

      const container =
        a.closest("article") ||
        a.closest("li") ||
        a.closest("section") ||
        a.closest("div") ||
        a;

      const snippet = clean((container?.innerText || a.innerText || "").slice(0, 3000));
      if (!snippet) continue;

      items.push({
        url: href,
        snippet
      });
    }

    const map = new Map();
    for (const item of items) {
      if (!map.has(item.url)) {
        map.set(item.url, item);
      }
    }

    return [...map.values()];
  }, pathPrefix);

  return candidates;
}

async function collectFallbackItems(page, dataType) {
  const rawItems = await page.locator("a, article, li, div").evaluateAll((nodes, dataType) => {
    const clean = (text) => String(text || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
    const patterns = dataType === "project"
      ? [/案件/, /単価/, /勤務地/, /スキル/, /商流/, /開始/, /リモート/]
      : [/人材/, /希望単価/, /単価/, /勤務地/, /スキル/, /稼働/, /所属/, /開始/];

    const items = [];
    for (const node of nodes) {
      const text = clean(node.innerText || "");
      if (!text || text.length < 20) continue;
      if (!patterns.some((p) => p.test(text))) continue;

      const href = node.href || node.closest("a")?.href || "";
      items.push({ url: href, snippet: text });
    }

    const seen = new Set();
    const unique = [];
    for (const item of items) {
      const key = `${item.url}__${item.snippet.slice(0, 160)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    return unique;
  }, dataType);

  return rawItems;
}

async function extractBestText(page) {
  const text = await page.evaluate(() => {
    const clean = (value) =>
      String(value || "")
        .replace(/\u00A0/g, " ")
        .replace(/\r/g, "")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");

    const score = (value) => {
      const labels = [
        "単価", "希望単価", "勤務地", "スキル", "商流", "開始", "開始時期",
        "開始可能時期", "リモート", "所属", "国籍", "最寄駅", "会社名", "年齢"
      ];
      let s = value.length;
      for (const label of labels) {
        if (value.includes(label)) s += 500;
      }
      return s;
    };

    const candidates = [
      ...document.querySelectorAll("main, article, section, [role='main'], .content, .detail, .container")
    ]
      .map((el) => clean(el.innerText))
      .filter((v) => v.length >= 80);

    candidates.sort((a, b) => score(b) - score(a));

    return candidates[0] || clean(document.body?.innerText || "");
  });

  return preserveMultiline(text);
}

async function extractHeading(page) {
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  const h2 = await page.locator("h2").first().textContent().catch(() => "");
  return clean(h1 || h2 || "");
}

async function fetchDetailedRecords(context, candidates, dataType) {
  if (!candidates.length) return [];

  const detailPage = await context.newPage();
  const records = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    try {
      if (candidate.url) {
        await detailPage.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await detailPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      }

      const h1 = candidate.url ? await extractHeading(detailPage) : "";
      const text = candidate.url ? await extractBestText(detailPage) : candidate.snippet;

      const parsed = dataType === "project"
        ? parseProjectText({ text, url: candidate.url || "", h1, snippet: candidate.snippet })
        : parseTalentText({ text, url: candidate.url || "", h1, snippet: candidate.snippet });

      records.push(parsed);

      if (i === 0 && candidate.url) {
        await saveDebug(detailPage, `${dataType}_detail_sample`);
      }
    } catch (error) {
      const fallback = dataType === "project"
        ? parseProjectText({ text: candidate.snippet, url: candidate.url || "", snippet: candidate.snippet })
        : parseTalentText({ text: candidate.snippet, url: candidate.url || "", snippet: candidate.snippet });

      records.push(fallback);
    }
  }

  await detailPage.close();

  const seen = new Set();
  return records.filter((row) => {
    const key = row.unique_key || `${row.project_title || row.talent_title}__${row.raw_text?.slice(0, 120)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function scrapeChoTatsu() {
  await ensureArtifactsDir();

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 2200 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4] });
  });

  const page = await context.newPage();

  try {
    await login(page);

    await page.goto(PROJECTS_URL, { waitUntil: "domcontentloaded" });
    await exhaustPage(page);
    await saveDebug(page, "projects_page");

    let projectCandidates = await collectDetailCandidates(page, "project");
    if (!projectCandidates.length) {
      projectCandidates = await collectFallbackItems(page, "project");
    }

    await page.goto(TALENTS_URL, { waitUntil: "domcontentloaded" });
    await exhaustPage(page);
    await saveDebug(page, "talents_page");

    let talentCandidates = await collectDetailCandidates(page, "talent");
    if (!talentCandidates.length) {
      talentCandidates = await collectFallbackItems(page, "talent");
    }

    const projects = await fetchDetailedRecords(context, projectCandidates, "project");
    const talents = await fetchDetailedRecords(context, talentCandidates, "talent");

    if (!projects.length && !talents.length) {
      throw new Error("案件・人材ともに0件でした。セレクタ調整が必要です");
    }

    return { projects, talents };
  } catch (error) {
    await saveDebug(page, "fatal_error");
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
