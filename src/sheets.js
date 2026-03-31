import { google } from "googleapis";

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が未設定です");
  }
  return JSON.parse(raw);
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth: await auth.getClient() });
}

export async function ensureSheet(spreadsheetId, title) {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }]
    }
  });
}

export async function getValues(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

export async function clearSheet(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
}

export async function updateValues(spreadsheetId, range, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

export async function appendValues(spreadsheetId, range, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）【】［］\[\]・／/＿_-]/g, "");
}

function pickByAliases(item, aliases) {
  for (const key of aliases) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") {
      return item[key];
    }
  }
  return "";
}

function valueForHeader(item, header, dataType) {
  const h = normalizeHeader(header);
  const common = {
    capturedat: ["captured_at", "取得日", "取得日時"],
    rawtext: ["raw_text", "raw", "詳細原文"],
    url: ["url", "案件url", "人材url", "リンク"],
    uniquekey: ["unique_key", "id", "key", "一意キー"]
  };

  const projectMap = {
    案件名: ["title", "project_name", "案件名", "title_guess"],
    title: ["title", "project_name", "案件名", "title_guess"],
    単価: ["unit_price", "単価"],
    勤務地: ["location", "勤務地"],
    スキル: ["skill", "skills", "必須スキル", "スキル"],
    必須スキル: ["must_skill", "skill", "skills"],
    尚可スキル: ["want_skill", "preferred_skill", "尚可スキル"],
    商流: ["commercial_flow", "商流"],
    開始時期: ["start_date", "開始時期", "開始"],
    参画時期: ["start_date", "開始時期", "開始"],
    稼働率: ["utilization", "稼働率", "稼働"],
    期間: ["period", "期間"],
    精算: ["settlement", "精算"],
    面談: ["interview_count", "面談"],
    年齢: ["age", "年齢"],
    国籍: ["nationality", "国籍"],
    募集人数: ["headcount", "募集人数"],
    リモート: ["remote", "リモート"],
    備考: ["note", "remarks", "備考"]
  };

  const talentMap = {
    人材名: ["name", "talent_name", "氏名", "人材名"],
    氏名: ["name", "talent_name", "氏名", "人材名"],
    title: ["name", "talent_name", "氏名", "人材名"],
    単価: ["desired_unit_price", "単価", "希望単価"],
    希望単価: ["desired_unit_price", "単価", "希望単価"],
    勤務地: ["location", "勤務地"],
    スキル: ["skill", "skills", "スキル"],
    稼働率: ["utilization", "稼働率", "稼働"],
    稼働: ["utilization", "稼働率", "稼働"],
    開始可能時期: ["available_from", "開始可能時期", "開始"],
    参画可能時期: ["available_from", "開始可能時期", "開始"],
    所属: ["affiliation", "所属"],
    年齢: ["age", "年齢"],
    性別: ["gender", "性別"],
    国籍: ["nationality", "国籍"],
    最寄駅: ["nearest_station", "最寄駅"],
    リモート: ["remote", "リモート"],
    備考: ["note", "remarks", "備考"]
  };

  const maps = dataType === "project" ? projectMap : talentMap;

  for (const [label, aliases] of Object.entries(common)) {
    if (h === normalizeHeader(label)) return pickByAliases(item, aliases);
  }
  for (const [label, aliases] of Object.entries(maps)) {
    if (h === normalizeHeader(label)) return pickByAliases(item, aliases);
  }

  return item[header] ?? item[h] ?? "";
}

export async function readObjects(spreadsheetId, sheetName) {
  const values = await getValues(spreadsheetId, `${sheetName}!A:ZZ`).catch(() => []);
  if (!values.length) return [];
  const [header, ...rows] = values;
  return rows.map(row => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])));
}

export async function writeObjectsRespectingExistingHeader(spreadsheetId, sheetName, dataType, items, fallbackHeader) {
  await ensureSheet(spreadsheetId, sheetName);
  const existing = await getValues(spreadsheetId, `${sheetName}!1:1`).catch(() => []);
  const header = existing[0]?.length ? existing[0] : fallbackHeader;

  const values = [
    header,
    ...items.map(item => header.map(h => valueForHeader(item, h, dataType)))
  ];

  await clearSheet(spreadsheetId, `${sheetName}!A:ZZ`);
  await updateValues(spreadsheetId, `${sheetName}!A1`, values);
}

export async function appendObjectsRespectingExistingHeader(spreadsheetId, sheetName, items, fallbackHeader) {
  if (!items.length) return;
  await ensureSheet(spreadsheetId, sheetName);
  const existing = await getValues(spreadsheetId, `${sheetName}!1:1`).catch(() => []);
  const header = existing[0]?.length ? existing[0] : fallbackHeader;

  if (!existing[0]?.length) {
    await updateValues(spreadsheetId, `${sheetName}!A1`, [header]);
  }

  const values = items.map(item => header.map(h => item[h] ?? item[normalizeHeader(h)] ?? item.unique_key ?? ""));
  await appendValues(spreadsheetId, `${sheetName}!A:A`, values);
}

export function buildDiffRows(beforeRows, afterRows, keyField, dataType) {
  const now = new Date().toISOString();
  const beforeMap = new Map(beforeRows.filter(r => r[keyField]).map(r => [r[keyField], r]));
  const afterMap = new Map(afterRows.filter(r => r[keyField]).map(r => [r[keyField], r]));
  const diffs = [];

  for (const [key, after] of afterMap.entries()) {
    const before = beforeMap.get(key);
    if (!before) {
      diffs.push({
        captured_at: now,
        data_type: dataType,
        diff_type: "new",
        unique_key: key,
        title: after.title || after.name || "",
        url: after.url || ""
      });
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push({
        captured_at: now,
        data_type: dataType,
        diff_type: "updated",
        unique_key: key,
        title: after.title || after.name || "",
        url: after.url || ""
      });
    }
  }

  for (const [key, before] of beforeMap.entries()) {
    if (!afterMap.has(key)) {
      diffs.push({
        captured_at: now,
        data_type: dataType,
        diff_type: "removed",
        unique_key: key,
        title: before.title || before.name || before["案件名"] || before["氏名"] || "",
        url: before.url || before["URL"] || ""
      });
    }
  }

  return diffs;
}

export const DEFAULT_PROJECT_HEADER = [
  "取得日時",
  "案件名",
  "単価",
  "勤務地",
  "スキル",
  "商流",
  "開始時期",
  "URL",
  "一意キー",
  "詳細原文"
];

export const DEFAULT_TALENT_HEADER = [
  "取得日時",
  "氏名",
  "希望単価",
  "勤務地",
  "スキル",
  "稼働率",
  "開始可能時期",
  "所属",
  "URL",
  "一意キー",
  "詳細原文"
];

export const DEFAULT_DIFF_HEADER = [
  "captured_at",
  "data_type",
  "diff_type",
  "unique_key",
  "title",
  "url"
];
