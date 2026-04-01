import fs from "fs/promises";
import { chromium } from "playwright";

const BASE_URL = "https://cho-tatsu.com";
const LOGIN_URL = `${BASE_URL}/login`;
const PROJECTS_URL = `${BASE_URL}/partners/projects`;
const TALENTS_URL = `${BASE_URL}/partners/talents`;
const ARTIFACTS_DIR = "artifacts";

const PROJECT_LABELS = [
  "案件タイトル", "案件名", "会社名", "社名", "企業名", "優先度", "単価", "単金", "職種", "ポジション",
  "スキル", "必須スキル", "尚可スキル", "年齢制限", "年齢", "リモート", "リモート条件", "商流", "商流制限",
  "個人事業主", "外国籍", "国籍", "勤務地", "都道府県", "開始時期", "開始", "参画時期", "募集人数",
  "面談", "精算", "期間", "備考"
];

const TALENT_LABELS = [
  "人材タイトル", "氏名", "人材名", "会社名", "社名", "企業名", "優先度", "希望単価", "単価", "単金",
  "年齢", "所属", "職種", "ポジション", "希望職種", "スキル", "稼働率", "稼働", "リモート", "リモート条件",
  "国籍", "外国籍", "勤務地", "都道府県", "最寄駅", "開始可能時期", "参画可能時期", "開始時期", "開始",
  "備考"
];

const NOISE_LINE_PATTERNS = [
  /^詳細を見る$/,
  /^一覧へ戻る$/,
  /^戻る$/,
  /^検索$/,
  /^並び替え$/,
  /^お気に入り$/,
  /^気になる$/,
  /^相談する$/,
  /^エントリー$/,
  /^応募する$/,
  /^ログアウト$/,
  /^マイページ$/,
  /^案件検索$/,
  /^人材検索$/,
  /^次へ$/,
  /^前へ$/,
  /^Page \d+$/i,
  /^TOP$/,
  /^HOME$/,
  /^MENU$/,
  /^Copy$/i,
  /^Copied$/i
];

const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県",
  "岐阜県","静岡県","愛知県","三重県",
  "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県",
  "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
];

function clean(text) {
  return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function splitLines(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map(line => clean(line))
    .filter(Boolean)
    .filter(line => !isNoiseLine(line));
}

function preserveMultiline(text) {
  return splitLines(text).join("\n");
}

function isNoiseLine(line) {
  const v = clean(line);
  if (!v) return true;
  if (NOISE_LINE_PATTERNS.some(re => re.test(v))) return true;
  if (/^(案件一覧|人材一覧)$/.test(v)) return true;
  return false;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function toAbsoluteUrl(href) {
  if (!href) return "";
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return href;
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePriceToMan(text) {
  const raw = clean(text);
  if (!raw) return "";
  const normalized = raw
    .replace(/税込|税別|月額|円|万\/月|万円\/月|万円|万/g, " ")
    .replace(/〜/g, "-")
    .replace(/～/g, "-")
    .replace(/[^0-9.\-]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^\-|-$/g, "")
    .trim();
  return normalized;
}

function extractPrefecture(text) {
  const value = clean(text);
  if (!value) return "";
  return PREFECTURES.find(p => value.includes(p)) || "";
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function buildUniqueKey(prefix, url, title, company, price) {
  const seed = pickFirstNonEmpty(url, `${title}__${company}__${price}`);
  return `${prefix}::${seed}`;
}

function looksLikeLabelLine(line, labels) {
  const value = clean(line);
  if (!value) return false;
  return labels.some(label => {
    const l = escapeRegExp(label);
    return new RegExp(`^${l}\\s*[:：]?$`).test(value) || new RegExp(`^${l}\\s*[:：]`).test(value);
  });
}

function findLabeledValue(text, labels, allLabels) {
  const source = String(text || "").replace(/\r/g, "");

  for (const label of labels) {
    const l = escapeRegExp(label);
    const inline = source.match(new RegExp(`(?:^|\\n)${l}\\s*[:：]\\s*([^\\n]+)`, "i"));
    if (inline?.[1]) return clean(inline[1]);
  }

  const lines = splitLines(source);
  for (let i = 0; i < lines.length; i += 1) {
    for (const label of labels) {
      const l = escapeRegExp(label);
      if (new RegExp(`^${l}\\s*[:：]\\s*(.+)$`, "i").test(lines[i])) {
        return clean(lines[i].replace(new RegExp(`^${l}\\s*[:：]\\s*`, "i"), ""));
      }
      if (new RegExp(`^${l}\\s*[:：]?$`, "i").test(lines[i])) {
        const next = lines[i + 1] || "";
        if (next && !looksLikeLabelLine(next, allLabels)) return clean(next);
      }
    }
  }

  return "";
}

function findSectionText(text, labels, allLabels) {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    const hit = labels.find(label => {
      const l = escapeRegExp(label);
      return new RegExp(`^${l}\\s*[:：]?$`, "i").test(current) || new RegExp(`^${l}\\s*[:：]`, "i").test(current);
    });
    if (!hit) continue;

    const inline = current.replace(new RegExp(`^${escapeRegExp(hit)}\\s*[:：]?\\s*`, "i"), "").trim();
    const bucket = [];
    if (inline) bucket.push(inline);

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (looksLikeLabelLine(next, allLabels)) break;
      bucket.push(next);
    }

    const merged = bucket.map(clean).filter(Boolean).join(" / ");
    if (merged) return merged;
  }
  return "";
}

function guessTitleFromLines(lines, labels, fallback = "") {
  const blacklist = new Set(labels);
  for (const line of lines) {
    const v = clean(line);
    if (!v) continue;
    if (blacklist.has(v)) continue;
    if (looksLikeLabelLine(v, labels)) continue;
    if (v.length <= 1) continue;
    if (/^(案件|人材)$/.test(v)) continue;
    return v;
  }
  return clean(fallback);
}

function guessPrice(text, isTalent = false) {
  const labeled = findLabeledValue(
    text,
    isTalent ? ["希望単価", "単価", "単金"] : ["単価", "単金", "希望単価"],
    isTalent ? TALENT_LABELS : PROJECT_LABELS
  );
  if (labeled) return normalizePriceToMan(labeled);
  const m = String(text || "").match(/(\d{2,3}(?:\.\d+)?\s*(?:[-~〜～]\s*\d{2,3}(?:\.\d+)?)?)\s*万円/);
  return m ? normalizePriceToMan(m[1]) : "";
}

function guessRemote(text) {
  const labeled = findLabeledValue(text, ["リモート条件", "リモート"], [...PROJECT_LABELS, ...TALENT_LABELS]);
  if (labeled) return labeled;
  const hit = String(text || "").match(/(フルリモート|リモート可|一部リモート|出社併用|常駐)/);
  return hit ? hit[1] : "";
}

function guessBooleanLike(text, labels) {
  const labeled = findLabeledValue(text, labels, [...PROJECT_LABELS, ...TALENT_LABELS]);
  if (labeled) return labeled;
  return "";
}

function mergeInfoText(cardText, detailText) {
  return uniq([...splitLines(cardText), ...splitLines(detailText)]).join("\n");
}

function buildProjectRecord(card, detail) {
  const cardText = preserveMultiline(card?.text || "");
  const detailText = preserveMultiline(detail?.text || "");
  const mergedText = mergeInfoText(cardText, detailText);
  const lines = splitLines(mergedText);

  const title = pickFirstNonEmpty(
    detail?.heading,
    findLabeledValue(mergedText, ["案件タイトル", "案件名"], PROJECT_LABELS),
    card?.anchorText,
    guessTitleFromLines(lines, PROJECT_LABELS)
  );

  const companyName = pickFirstNonEmpty(
    findLabeledValue(mergedText, ["会社名", "社名", "企業名"], PROJECT_LABELS)
  );

  const location = pickFirstNonEmpty(
    findLabeledValue(mergedText, ["勤務地", "場所", "勤務場所", "都道府県"], PROJECT_LABELS),
    findSectionText(mergedText, ["勤務地", "場所", "勤務場所"], PROJECT_LABELS)
  );

  const remoteCondition = pickFirstNonEmpty(
    guessRemote(mergedText)
  );

  const skill = pickFirstNonEmpty(
    findSectionText(mergedText, ["スキル", "必須スキル", "尚可スキル", "言語", "環境"], PROJECT_LABELS),
    findLabeledValue(mergedText, ["スキル", "必須スキル", "尚可スキル"], PROJECT_LABELS)
  );

  const record = {
    captured_at: new Date().toISOString(),
    project_title: title,
    title,
    company_name: companyName,
    priority: findLabeledValue(mergedText, ["優先度"], PROJECT_LABELS),
    unit_price: findLabeledValue(mergedText, ["単価", "単金"], PROJECT_LABELS),
    price_man: guessPrice(mergedText, false),
    job_type: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["職種", "ポジション", "募集職種"], PROJECT_LABELS),
      findSectionText(mergedText, ["職種", "ポジション", "募集職種"], PROJECT_LABELS)
    ),
    skill,
    age_limit: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["年齢制限", "年齢"], PROJECT_LABELS)
    ),
    remote: remoteCondition,
    remote_condition: remoteCondition,
    commercial_flow: findLabeledValue(mergedText, ["商流"], PROJECT_LABELS),
    commercial_flow_limit: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["商流制限", "商流"], PROJECT_LABELS)
    ),
    sole_proprietor: guessBooleanLike(mergedText, ["個人事業主"]),
    foreign_nationality: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["外国籍", "国籍"], PROJECT_LABELS)
    ),
    nationality: findLabeledValue(mergedText, ["外国籍", "国籍"], PROJECT_LABELS),
    location,
    prefecture: extractPrefecture(location || mergedText),
    start_date: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["開始時期", "開始", "参画時期"], PROJECT_LABELS),
      findSectionText(mergedText, ["開始時期", "開始", "参画時期"], PROJECT_LABELS)
    ),
    project_info: mergedText,
    raw_text: mergedText,
    url: toAbsoluteUrl(card?.href || detail?.url || ""),
    unique_key: buildUniqueKey("project", toAbsoluteUrl(card?.href || detail?.url || ""), title, companyName, guessPrice(mergedText, false))
  };

  return record;
}

function buildTalentRecord(card, detail) {
  const cardText = preserveMultiline(card?.text || "");
  const detailText = preserveMultiline(detail?.text || "");
  const mergedText = mergeInfoText(cardText, detailText);
  const lines = splitLines(mergedText);

  const title = pickFirstNonEmpty(
    detail?.heading,
    findLabeledValue(mergedText, ["人材タイトル", "氏名", "人材名"], TALENT_LABELS),
    card?.anchorText,
    guessTitleFromLines(lines, TALENT_LABELS)
  );

  const location = pickFirstNonEmpty(
    findLabeledValue(mergedText, ["勤務地", "場所", "勤務場所", "都道府県"], TALENT_LABELS),
    findSectionText(mergedText, ["勤務地", "場所", "勤務場所"], TALENT_LABELS)
  );

  const remoteCondition = pickFirstNonEmpty(
    guessRemote(mergedText)
  );

  const skill = pickFirstNonEmpty(
    findSectionText(mergedText, ["スキル", "言語", "環境"], TALENT_LABELS),
    findLabeledValue(mergedText, ["スキル"], TALENT_LABELS)
  );

  const companyName = pickFirstNonEmpty(
    findLabeledValue(mergedText, ["会社名", "社名", "企業名"], TALENT_LABELS)
  );

  const record = {
    captured_at: new Date().toISOString(),
    talent_title: title,
    name: title,
    company_name: companyName,
    priority: findLabeledValue(mergedText, ["優先度"], TALENT_LABELS),
    desired_unit_price: findLabeledValue(mergedText, ["希望単価", "単価", "単金"], TALENT_LABELS),
    price_man: guessPrice(mergedText, true),
    age: findLabeledValue(mergedText, ["年齢"], TALENT_LABELS),
    affiliation: findLabeledValue(mergedText, ["所属"], TALENT_LABELS),
    job_type: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["職種", "ポジション", "希望職種"], TALENT_LABELS),
      findSectionText(mergedText, ["職種", "ポジション", "希望職種"], TALENT_LABELS)
    ),
    skill,
    remote: remoteCondition,
    remote_condition: remoteCondition,
    nationality: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["国籍", "外国籍"], TALENT_LABELS)
    ),
    location,
    prefecture: extractPrefecture(location || mergedText),
    nearest_station: findLabeledValue(mergedText, ["最寄駅"], TALENT_LABELS),
    start_date: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["開始可能時期", "参画可能時期", "開始時期", "開始"], TALENT_LABELS),
      findSectionText(mergedText, ["開始可能時期", "参画可能時期", "開始時期", "開始"], TALENT_LABELS)
    ),
    available_from: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["開始可能時期", "参画可能時期", "開始時期", "開始"], TALENT_LABELS)
    ),
    utilization: pickFirstNonEmpty(
      findLabeledValue(mergedText, ["稼働率", "稼働"], TALENT_LABELS)
    ),
    talent_info: mergedText,
    raw_text: mergedText,
    url: toAbsoluteUrl(card?.href || detail?.url || ""),
    unique_key: buildUniqueKey("talent", toAbsoluteUrl(card?.href || detail?.url || ""), title, companyName, guessPrice(mergedText, true))
  };

  return record;
}

async function ensureArtifactsDir() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
}

async function saveJson(name, value) {
  await ensureArtifactsDir();
  await fs.writeFile(`${ARTIFACTS_DIR}/${name}.json`, JSON.stringify(value, null, 2), "utf8");
}

async function saveDebug(page, name) {
  await ensureArtifactsDir();
  await page.screenshot({ path: `${ARTIFACTS_DIR}/${name}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${ARTIFACTS_DIR}/${name}.html`, await page.content(), "utf8").catch(() => {});
}

async function buildBrowser() {
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
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US", "en"] });
    Object.defineProperty(navigator, "plugins", {
      get: () => [{ name: "Chrome PDF Plugin" }, { name: "Chrome PDF Viewer" }, { name: "Native Client" }]
    });
  });

  return { browser, context };
}

async function login(page) {
  const email = process.env.CHO_TATSU_EMAIL;
  const password = process.env.CHO_TATSU_PASSWORD;

  if (!email || !password) {
    throw new Error("CHO_TATSU_EMAIL / CHO_TATSU_PASSWORD が未設定です");
  }

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30000 });
  await page.waitForSelector('input[name="password"]', { timeout: 30000 });

  await page.locator('input[name="email"]').click();
  await page.locator('input[name="email"]').fill("");
  await page.locator('input[name="email"]').type(email, { delay: 40 });
  await page.locator('input[name="password"]').click();
  await page.locator('input[name="password"]').fill("");
  await page.locator('input[name="password"]').type(password, { delay: 40 });

  const submit = page.locator('button[type="submit"], input[type="submit"]');
  await submit.first().click({ timeout: 10000 });

  try {
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30000 });
  } catch {
    await page.waitForTimeout(5000);
  }

  if (page.url().includes("/login")) {
    await saveDebug(page, "login_failed");
    throw new Error("ログインに失敗しました。artifacts/login_failed.* を確認してください");
  }
}

async function clickNextIfExists(page) {
  const candidates = page.locator('a, button, [role="button"]');
  const count = Math.min(await candidates.count(), 200);

  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const text = clean(await candidate.textContent().catch(() => ""));
    if (!text.includes("次へ")) continue;
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    const disabled = await candidate.isDisabled().catch(() => false);
    if (disabled) return false;

    await Promise.allSettled([
      page.waitForLoadState("networkidle", { timeout: 15000 }),
      candidate.click({ timeout: 5000 })
    ]);
    await page.waitForTimeout(1500);
    return true;
  }

  return false;
}

async function exhaustPage(page) {
  const seenUrls = new Set();

  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    for (let i = 0; i < 12; i += 1) {
      const before = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
      await page.mouse.wheel(0, 8000);
      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
      if (after <= before) break;
    }

    const currentUrl = page.url();
    if (seenUrls.has(currentUrl)) break;
    seenUrls.add(currentUrl);

    const moved = await clickNextIfExists(page);
    if (!moved) break;
  }
}

async function collectCards(page, dataType) {
  const cards = await page.evaluate(({ baseUrl, dataType }) => {
    const clean = (text) => String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const pathNeedle = dataType === "project" ? "/partners/projects/" : "/partners/talents/";
    const listPath = dataType === "project" ? "/partners/projects" : "/partners/talents";
    const labels = dataType === "project"
      ? ["案件", "単価", "勤務地", "スキル", "商流", "開始", "職種"]
      : ["人材", "単価", "希望単価", "所属", "スキル", "稼働", "開始", "職種"];

    const normalizeHref = (href) => {
      try { return new URL(href, baseUrl).toString(); } catch { return href || ""; }
    };

    const isDetailHref = (href) => {
      if (!href) return false;
      const abs = normalizeHref(href);
      try {
        const u = new URL(abs);
        return u.pathname.includes(pathNeedle) && u.pathname !== listPath;
      } catch {
        return abs.includes(pathNeedle) && !abs.endsWith(listPath);
      }
    };

    const scoreText = (text) => labels.reduce((acc, label) => acc + (text.includes(label) ? 1 : 0), 0);

    const chooseContainer = (anchor) => {
      let node = anchor;
      let best = anchor;
      let bestScore = -1;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const text = clean(node.innerText || "");
        if (!text || text.length < 20 || text.length > 6000) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 200 || rect.height < 40) continue;
        const score = scoreText(text) + Math.min(Math.floor(text.length / 120), 4);
        if (score > bestScore) {
          best = node;
          bestScore = score;
        }
      }
      return best;
    };

    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .filter(a => isDetailHref(a.getAttribute("href") || a.href));

    const rows = anchors.map(anchor => {
      const container = chooseContainer(anchor);
      const text = clean(container?.innerText || anchor.innerText || "");
      return {
        href: normalizeHref(anchor.getAttribute("href") || anchor.href || ""),
        anchorText: clean(anchor.innerText || anchor.textContent || ""),
        text,
        y: container?.getBoundingClientRect?.().top ?? anchor.getBoundingClientRect?.().top ?? 0
      };
    }).filter(row => row.href && row.text && row.text.length >= 20);

    const dedup = [];
    const seen = new Set();
    for (const row of rows.sort((a, b) => a.y - b.y)) {
      if (seen.has(row.href)) continue;
      seen.add(row.href);
      dedup.push(row);
    }

    if (dedup.length) return dedup;

    const fallbackNodes = Array.from(document.querySelectorAll("article, li, section, div"));
    const fallback = [];
    for (const node of fallbackNodes) {
      const text = clean(node.innerText || "");
      if (!text || text.length < 40 || text.length > 5000) continue;
      const hitCount = scoreText(text);
      if (hitCount < 2) continue;
      const link = node.querySelector("a[href]");
      fallback.push({
        href: normalizeHref(link?.getAttribute("href") || link?.href || ""),
        anchorText: clean(link?.innerText || ""),
        text,
        y: node.getBoundingClientRect().top
      });
    }

    return fallback.sort((a, b) => a.y - b.y).slice(0, 500);
  }, { baseUrl: BASE_URL, dataType });

  const unique = [];
  const seen = new Set();
  for (const card of cards) {
    const key = `${card.href}__${card.text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
  }
  return unique;
}

async function extractDetail(context, url, namePrefix) {
  if (!url) {
    return { url: "", heading: "", text: "" };
  }

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.mouse.wheel(0, 2500).catch(() => {});
    await page.waitForTimeout(800);

    const payload = await page.evaluate(() => {
      const clean = (text) => String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const heading = clean(
        document.querySelector("h1")?.innerText ||
        document.querySelector("h2")?.innerText ||
        document.querySelector("main h3")?.innerText ||
        document.title ||
        ""
      );
      const article = document.querySelector("main") || document.body;
      const text = String(article?.innerText || "").replace(/\u00a0/g, " ").trim();
      return { heading, text };
    });

    return { url, heading: clean(payload.heading), text: preserveMultiline(payload.text) };
  } catch (error) {
    await saveDebug(page, `${namePrefix}_detail_error`).catch(() => {});
    return { url, heading: "", text: "" };
  } finally {
    await page.close().catch(() => {});
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => run()));
  return results;
}

async function collectRecords(page, context, dataType) {
  const cards = await collectCards(page, dataType);
  await saveJson(`${dataType}_cards`, cards);

  const details = await mapWithConcurrency(cards, 4, async (card, index) => {
    return extractDetail(context, card.href, `${dataType}_${index + 1}`);
  });

  const records = cards.map((card, index) => {
    const detail = details[index] || { url: card.href, heading: "", text: "" };
    return dataType === "project"
      ? buildProjectRecord(card, detail)
      : buildTalentRecord(card, detail);
  }).filter(row => {
    const title = dataType === "project" ? row.project_title : row.talent_title;
    return clean(title) || clean(row.url) || clean(row.raw_text);
  });

  await saveJson(`${dataType}_preview`, records.slice(0, 20));
  return records;
}

export async function scrapeChoTatsu() {
  await ensureArtifactsDir();
  const { browser, context } = await buildBrowser();
  const page = await context.newPage();

  try {
    await login(page);

    await page.goto(PROJECTS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await exhaustPage(page);
    await saveDebug(page, "projects_page");
    const projects = await collectRecords(page, context, "project");

    await page.goto(TALENTS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await exhaustPage(page);
    await saveDebug(page, "talents_page");
    const talents = await collectRecords(page, context, "talent");

    if (!projects.length && !talents.length) {
      throw new Error("案件・人材ともに0件でした。セレクタ調整が必要です");
    }

    return { projects, talents };
  } catch (error) {
    await saveDebug(page, "fatal_error").catch(() => {});
    throw error;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
