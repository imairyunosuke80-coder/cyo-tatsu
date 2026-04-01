import fs from "fs/promises";
import { chromium } from "playwright";

const BASE_URL = "https://cho-tatsu.com";
const LOGIN_URL = `${BASE_URL}/login`;
const PROJECTS_URL = `${BASE_URL}/partners/projects`;
const TALENTS_URL = `${BASE_URL}/partners/talents`;

const PROJECT_LABELS = [
  "案件タイトル",
  "案件名",
  "会社名",
  "社名",
  "企業名",
  "優先度",
  "単価",
  "単金",
  "職種",
  "ポジション",
  "スキル",
  "必須スキル",
  "尚可スキル",
  "年齢制限",
  "年齢",
  "リモート",
  "商流",
  "商流制限",
  "個人事業主",
  "外国籍",
  "国籍",
  "勤務地",
  "都道府県",
  "開始時期",
  "参画時期",
  "案件情報"
];

const TALENT_LABELS = [
  "人材タイトル",
  "人材名",
  "氏名",
  "会社名",
  "社名",
  "企業名",
  "優先度",
  "単価",
  "希望単価",
  "年齢",
  "所属",
  "職種",
  "ポジション",
  "希望職種",
  "スキル",
  "リモート",
  "リモート条件",
  "国籍",
  "外国籍",
  "勤務地",
  "都道府県",
  "最寄駅",
  "開始時期",
  "開始可能時期",
  "参画可能時期",
  "人材情報"
];

const NOISE_PATTERNS = [
  /連携中の案件を探す/,
  /連携中の人材を探す/,
  /連携企業を増やすと/,
  /案件を絞り込む/,
  /人材を絞り込む/,
  /案件を見る/,
  /人材を見る/,
  /表示中\s*\/\s*全\d+件/,
  /^\d+\-\d+件\s*表示中/,
  /お問合せ/,
  /利用規約/,
  /チョータツとは/,
  /ログイン/,
  /パスワードを忘れた方はこちら/,
  /アカウントをお持ちでない方はこちら/,
  /お申し込みはこちら/
];

function clean(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function preserveMultiline(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean)
    .join("\n");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countLabelHits(text, labels) {
  const source = preserveMultiline(text);
  return labels.reduce((count, label) => count + (source.includes(label) ? 1 : 0), 0);
}

function isNoiseText(text) {
  const source = preserveMultiline(text);
  if (!source) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(source));
}

function pickFirstNonEmpty(...values) {
  return values.find((v) => clean(v)) || "";
}

function normalizePriceToMan(text) {
  const value = clean(text);
  if (!value) return "";
  return value
    .replace(/税込/g, "")
    .replace(/税抜/g, "")
    .replace(/月額/g, "")
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
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
    "岐阜県", "静岡県", "愛知県", "三重県",
    "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
    "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県",
    "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
  ];

  return prefectures.find((p) => value.includes(p)) || value;
}

function guessCompanyName(lines) {
  return (
    lines.find((line) =>
      /(株式会社|合同会社|有限会社|Inc\.|LLC|Technology|テクノロジー)/i.test(line) &&
      line.length <= 120
    ) || ""
  );
}

function guessPriority(lines) {
  return lines.find((line) => /^(高|中|低|-|A|B|C)$/.test(line)) || "";
}

function guessPrice(text) {
  const source = preserveMultiline(text);
  const m = source.match(/(\d{1,3}(?:\s*[~〜\-～]\s*\d{1,3})?)\s*万円/);
  return m ? clean(`${m[1]}万円`) : "";
}

function guessAge(text) {
  const source = preserveMultiline(text);
  const m = source.match(/(\d{2})歳/);
  return m ? `${m[1]}歳` : "";
}

function guessNearestStation(lines) {
  return lines.find((line) => /駅$/.test(line) && line.length <= 60) || "";
}

function guessRemote(text) {
  const source = preserveMultiline(text);
  const candidates = [
    "フルリモート",
    "基本リモート",
    "リモート併用",
    "リモート可",
    "一部リモート",
    "フル常駐",
    "基本出社",
    "常駐"
  ];
  return candidates.find((w) => source.includes(w)) || "";
}

function guessBooleanLike(text, leftWord, rightWord = "") {
  const source = preserveMultiline(text);
  const m = source.match(new RegExp(`${escapeRegExp(leftWord)}\\s*[:：]?\\s*(可|不可|相談可|相談不可)`));
  if (m) return m[1];
  if (rightWord) {
    const m2 = source.match(new RegExp(`${escapeRegExp(rightWord)}\\s*[:：]?\\s*(可|不可|相談可|相談不可)`));
    if (m2) return m2[1];
  }
  return "";
}

function isMetaLine(line, labels) {
  if (!line) return true;
  if (isNoiseText(line)) return true;
  if (/^\d{4}\/\d{2}\/\d{2}/.test(line)) return true;
  if (/^\d{1,3}万円$/.test(line)) return true;
  if (/^\d{2}歳$/.test(line)) return true;
  if (/^\d+\-\d+件/.test(line)) return true;
  if (countLabelHits(line, labels) >= 3) return true;
  if (labels.some((label) => line === label || line.startsWith(`${label}：`) || line.startsWith(`${label}:`))) return true;
  return false;
}

function guessTitle(lines, labels, fallback = "") {
  const title = lines.find((line) => {
    if (line.length < 3 || line.length > 160) return false;
    if (isMetaLine(line, labels)) return false;
    return true;
  });
  return title || fallback || "";
}

function matchValue(text, labels) {
  const source = preserveMultiline(text);
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]\\s*([^\\n]+)`, "i"),
      new RegExp(`(?:^|\\n)\\s*${escaped}\\s*(?:\\n)+\\s*([^\\n]+)`, "i"),
      new RegExp(`${escaped}\\s*[:：]?\\s*([^\\n]+)`, "i")
    ];
    for (const regex of patterns) {
      const hit = source.match(regex);
      if (hit?.[1]) return clean(hit[1]);
    }
  }
  return "";
}

function mergeTextBlocks(...texts) {
  const lines = [];
  const seen = new Set();

  for (const text of texts) {
    const normalized = preserveMultiline(text);
    if (!normalized) continue;

    for (const line of normalized.split("\n")) {
      const key = clean(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(key);
    }
  }

  return lines.join("\n");
}

function buildProjectRecord({ cardText, detailText, url, titleHint = "", heading = "" }) {
  const merged = mergeTextBlocks(cardText, detailText);
  const lines = merged.split("\n").map(clean).filter(Boolean);

  const location = pickFirstNonEmpty(
    matchValue(merged, ["勤務地", "場所", "勤務場所"]),
    matchValue(merged, ["都道府県"]),
    lines.find((line) => /都|道|府|県/.test(line) && line.length <= 30) || ""
  );

  const rawPrice = pickFirstNonEmpty(
    matchValue(merged, ["単価", "単金", "金額", "月額"]),
    guessPrice(merged)
  );

  const title = pickFirstNonEmpty(
    clean(heading),
    matchValue(merged, ["案件タイトル", "案件名", "タイトル"]),
    guessTitle(lines, PROJECT_LABELS, clean(titleHint))
  );

  return {
    captured_at: new Date().toISOString(),
    project_title: title,
    title,
    company_name: pickFirstNonEmpty(
      matchValue(merged, ["会社名", "社名", "企業名", "クライアント", "元請"]),
      guessCompanyName(lines)
    ),
    priority: pickFirstNonEmpty(
      matchValue(merged, ["優先度"]),
      guessPriority(lines)
    ),
    unit_price: rawPrice,
    price_man: normalizePriceToMan(rawPrice),
    job_type: matchValue(merged, ["職種", "ポジション", "募集職種"]),
    skill: pickFirstNonEmpty(
      matchValue(merged, ["スキル", "必須スキル"]),
      matchValue(merged, ["言語", "環境"])
    ),
    must_skill: matchValue(merged, ["必須スキル"]),
    want_skill: matchValue(merged, ["尚可スキル"]),
    age_limit: pickFirstNonEmpty(
      matchValue(merged, ["年齢制限"]),
      guessAge(merged)
    ),
    remote: pickFirstNonEmpty(
      matchValue(merged, ["リモート"]),
      guessRemote(merged)
    ),
    remote_condition: pickFirstNonEmpty(
      matchValue(merged, ["リモート条件", "リモート"]),
      guessRemote(merged)
    ),
    commercial_flow: matchValue(merged, ["商流"]),
    commercial_flow_limit: pickFirstNonEmpty(
      matchValue(merged, ["商流制限"]),
      matchValue(merged, ["商流"])
    ),
    sole_proprietor: pickFirstNonEmpty(
      matchValue(merged, ["個人事業主", "個人可", "個人事業主可否"]),
      guessBooleanLike(merged, "個人事業主", "個人可")
    ),
    nationality: matchValue(merged, ["国籍"]),
    foreign_nationality: pickFirstNonEmpty(
      matchValue(merged, ["外国籍", "外国籍可否"]),
      guessBooleanLike(merged, "外国籍", "外国籍可否"),
      matchValue(merged, ["国籍"])
    ),
    location,
    prefecture: extractPrefecture(location),
    start_date: pickFirstNonEmpty(
      matchValue(merged, ["開始時期", "参画時期", "開始日"]),
      matchValue(merged, ["開始"])
    ),
    project_info: merged,
    raw_text: merged,
    url,
    unique_key: url || `${title}__${merged.slice(0, 200)}`
  };
}

function buildTalentRecord({ cardText, detailText, url, titleHint = "", heading = "" }) {
  const merged = mergeTextBlocks(cardText, detailText);
  const lines = merged.split("\n").map(clean).filter(Boolean);

  const location = pickFirstNonEmpty(
    matchValue(merged, ["勤務地", "場所", "勤務場所"]),
    matchValue(merged, ["都道府県"]),
    lines.find((line) => /都|道|府|県/.test(line) && line.length <= 30) || ""
  );

  const rawPrice = pickFirstNonEmpty(
    matchValue(merged, ["希望単価", "単価", "単金", "金額", "月額"]),
    guessPrice(merged)
  );

  const title = pickFirstNonEmpty(
    clean(heading),
    matchValue(merged, ["人材タイトル", "人材名", "氏名", "タイトル"]),
    guessTitle(lines, TALENT_LABELS, clean(titleHint))
  );

  return {
    captured_at: new Date().toISOString(),
    talent_title: title,
    name: title,
    company_name: pickFirstNonEmpty(
      matchValue(merged, ["会社名", "社名", "企業名"]),
      guessCompanyName(lines)
    ),
    priority: pickFirstNonEmpty(
      matchValue(merged, ["優先度"]),
      guessPriority(lines)
    ),
    desired_unit_price: rawPrice,
    price_man: normalizePriceToMan(rawPrice),
    age: pickFirstNonEmpty(
      matchValue(merged, ["年齢"]),
      guessAge(merged)
    ),
    affiliation: matchValue(merged, ["所属"]),
    job_type: matchValue(merged, ["職種", "ポジション", "希望職種"]),
    skill: pickFirstNonEmpty(
      matchValue(merged, ["スキル"]),
      matchValue(merged, ["言語", "環境"])
    ),
    remote: pickFirstNonEmpty(
      matchValue(merged, ["リモート"]),
      guessRemote(merged)
    ),
    remote_condition: pickFirstNonEmpty(
      matchValue(merged, ["リモート条件", "リモート"]),
      guessRemote(merged)
    ),
    nationality: pickFirstNonEmpty(
      matchValue(merged, ["国籍"]),
      matchValue(merged, ["外国籍"])
    ),
    location,
    prefecture: extractPrefecture(location),
    nearest_station: pickFirstNonEmpty(
      matchValue(merged, ["最寄駅"]),
      guessNearestStation(lines)
    ),
    utilization: matchValue(merged, ["稼働率", "稼働"]),
    available_from: pickFirstNonEmpty(
      matchValue(merged, ["開始可能時期", "参画可能時期", "開始時期"]),
      matchValue(merged, ["開始"])
    ),
    start_date: pickFirstNonEmpty(
      matchValue(merged, ["開始可能時期", "参画可能時期", "開始時期"]),
      matchValue(merged, ["開始"])
    ),
    talent_info: merged,
    raw_text: merged,
    url,
    unique_key: url || `${title}__${merged.slice(0, 200)}`
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

async function saveJson(name, data) {
  await ensureArtifactsDir();
  await fs.writeFile(`artifacts/${name}.json`, JSON.stringify(data, null, 2), "utf8");
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
    page.locator("text=案件").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  ]);

  await page.waitForTimeout(2500);

  if (!loginSuccess || page.url().includes("/login")) {
    await saveDebug(page, "login_failed");
    throw new Error("ログインに失敗しました。artifacts/login_failed.* を確認してください");
  }
}

async function exhaustPage(page) {
  let previousHeight = -1;

  for (let i = 0; i < 25; i++) {
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

    if (!(await nextButton.count())) break;

    const first = nextButton.first();
    const disabled = await first.isDisabled().catch(() => false);
    if (disabled) break;

    await Promise.allSettled([
      page.waitForLoadState("networkidle", { timeout: 15000 }),
      first.click({ timeout: 5000 })
    ]);

    await page.waitForTimeout(1500);
  }
}

async function collectListingCards(page, dataType) {
  const detailPrefix = dataType === "project" ? "/partners/projects/" : "/partners/talents/";
  const listPath = dataType === "project" ? "/partners/projects" : "/partners/talents";
  const labels = dataType === "project" ? PROJECT_LABELS : TALENT_LABELS;

  const rawCards = await page.locator(`a[href*="${detailPrefix}"]`).evaluateAll(
    (anchors, payload) => {
      const { detailPrefix, listPath, labels, noisePatterns } = payload;

      const clean = (text) =>
        String(text || "")
          .replace(/\u00A0/g, " ")
          .replace(/\r/g, "")
          .replace(/[ \t]+/g, " ")
          .trim();

      const preserve = (text) =>
        String(text || "")
          .replace(/\u00A0/g, " ")
          .replace(/\r/g, "")
          .split(/\n+/)
          .map((line) => clean(line))
          .filter(Boolean)
          .join("\n");

      const noiseRegexes = noisePatterns.map((p) => new RegExp(p));
      const containsNoise = (text) => noiseRegexes.some((r) => r.test(text));
      const labelHits = (text) => labels.reduce((n, label) => n + (text.includes(label) ? 1 : 0), 0);

      const results = [];

      for (const anchor of anchors) {
        const href = anchor.href || "";
        if (!href) continue;

        let pathname = "";
        try {
          pathname = new URL(href).pathname;
        } catch {
          continue;
        }

        if (!pathname.startsWith(detailPrefix)) continue;
        if (pathname === listPath) continue;

        let best = null;
        let node = anchor;

        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
          const text = preserve(node.innerText || "");
          if (!text) continue;
          if (text.length < 40 || text.length > 2400) continue;

          let score = 0;
          score += labelHits(text) * 120;
          score -= Math.abs(text.length - 450) / 6;
          score -= depth * 10;

          if (containsNoise(text)) score -= 600;
          if (node.tagName === "ARTICLE") score += 120;
          if (node.tagName === "LI") score += 80;
          if (node.tagName === "A") score += 20;

          if (!best || score > best.score) {
            best = { text, score };
          }
        }

        const cardText = best?.text || preserve(anchor.innerText || "");
        if (!cardText) continue;
        if (containsNoise(cardText)) continue;

        const anchorText = preserve(anchor.innerText || "");
        results.push({
          url: href,
          anchor_text: anchorText,
          card_text: cardText
        });
      }

      const unique = [];
      const seen = new Set();

      for (const item of results) {
        const key = item.url;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
      }

      return unique;
    },
    {
      detailPrefix,
      listPath,
      labels,
      noisePatterns: NOISE_PATTERNS.map((p) => p.source)
    }
  );

  const filtered = rawCards.filter((item) => {
    if (!item?.url || !item?.card_text) return false;
    if (isNoiseText(item.card_text)) return false;
    if (countLabelHits(item.card_text, labels) === 0 && item.card_text.length < 80) return false;
    return true;
  });

  await saveJson(`${dataType}_cards`, filtered.slice(0, 50));
  return filtered;
}

async function extractDetailText(page, dataType) {
  const labels = dataType === "project" ? PROJECT_LABELS : TALENT_LABELS;

  const bestText = await page.evaluate(
    ({ labels, noisePatterns }) => {
      const clean = (text) =>
        String(text || "")
          .replace(/\u00A0/g, " ")
          .replace(/\r/g, "")
          .replace(/[ \t]+/g, " ")
          .trim();

      const preserve = (text) =>
        String(text || "")
          .replace(/\u00A0/g, " ")
          .replace(/\r/g, "")
          .split(/\n+/)
          .map((line) => clean(line))
          .filter(Boolean)
          .join("\n");

      const noiseRegexes = noisePatterns.map((p) => new RegExp(p));
      const containsNoise = (text) => noiseRegexes.some((r) => r.test(text));
      const labelHits = (text) => labels.reduce((n, label) => n + (text.includes(label) ? 1 : 0), 0);

      const nodes = Array.from(
        document.querySelectorAll("main, article, section, div, li")
      );

      let best = null;

      for (const node of nodes) {
        const text = preserve(node.innerText || "");
        if (!text) continue;
        if (text.length < 80 || text.length > 5000) continue;

        let score = 0;
        score += labelHits(text) * 140;
        score -= Math.abs(text.length - 1200) / 8;

        if (containsNoise(text)) score -= 800;
        if (node.tagName === "MAIN") score += 180;
        if (node.tagName === "ARTICLE") score += 150;
        if (text.includes("案件情報") || text.includes("人材情報")) score += 150;

        if (!best || score > best.score) {
          best = { text, score };
        }
      }

      return best?.text || preserve(document.body?.innerText || "");
    },
    {
      labels,
      noisePatterns: NOISE_PATTERNS.map((p) => p.source)
    }
  );

  return preserveMultiline(bestText);
}

async function extractHeading(page) {
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  const h2 = await page.locator("h2").first().textContent().catch(() => "");
  return clean(h1 || h2 || "");
}

async function processCardsToRecords(context, cards, dataType) {
  if (!cards.length) return [];

  const concurrency = Math.min(4, cards.length);
  const results = new Array(cards.length);
  let cursor = 0;
  let sampleSaved = false;

  const workers = Array.from({ length: concurrency }, async () => {
    const detailPage = await context.newPage();

    try {
      while (true) {
        const index = cursor++;
        if (index >= cards.length) break;

        const card = cards[index];
        let detailText = "";
        let heading = "";

        try {
          await detailPage.goto(card.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await detailPage.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

          heading = await extractHeading(detailPage);
          detailText = await extractDetailText(detailPage, dataType);

          if (!sampleSaved) {
            sampleSaved = true;
            await saveDebug(detailPage, `${dataType}_detail_sample`);
          }
        } catch {
          detailText = "";
        }

        const record =
          dataType === "project"
            ? buildProjectRecord({
                cardText: card.card_text,
                detailText,
                url: card.url,
                titleHint: card.anchor_text,
                heading
              })
            : buildTalentRecord({
                cardText: card.card_text,
                detailText,
                url: card.url,
                titleHint: card.anchor_text,
                heading
              });

        results[index] = record;
      }
    } finally {
      await detailPage.close();
    }
  });

  await Promise.all(workers);

  const deduped = [];
  const seen = new Set();

  for (const row of results.filter(Boolean)) {
    const key = row.unique_key || row.url || `${row.project_title || row.talent_title}__${row.raw_text?.slice(0, 200)}`;
    if (!key || seen.has(key)) continue;
    if (isNoiseText(row.raw_text || row.project_info || row.talent_info || "")) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
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

    const projectCards = await collectListingCards(page, "project");

    await page.goto(TALENTS_URL, { waitUntil: "domcontentloaded" });
    await exhaustPage(page);
    await saveDebug(page, "talents_page");

    const talentCards = await collectListingCards(page, "talent");

    const projects = await processCardsToRecords(context, projectCards, "project");
    const talents = await processCardsToRecords(context, talentCards, "talent");

    await saveJson("projects_preview", projects.slice(0, 10));
    await saveJson("talents_preview", talents.slice(0, 10));

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
