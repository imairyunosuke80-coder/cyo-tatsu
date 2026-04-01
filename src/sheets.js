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

  return google.sheets({
    version: "v4",
    auth: await auth.getClient()
  });
}

export async function ensureSheet(spreadsheetId, title) {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === title);
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

function buildSyntheticKey(item) {
  return (
    item["一意キー"] ||
    item.unique_key ||
    item["URL"] ||
    item.url ||
    [
      item["案件タイトル"] || item.project_title || "",
      item["人材タイトル"] || item.talent_title || "",
      item["案件情報"] || item.project_info || "",
      item["人材情報"] || item.talent_info || ""
    ]
      .filter(Boolean)
      .join("__")
      .slice(0, 500)
  );
}

function enrichReadObject(obj) {
  const url = obj["URL"] || obj.url || "";
  const uniqueKey = buildSyntheticKey(obj);

  return {
    ...obj,
    url,
    unique_key: uniqueKey,
    project_title: obj["案件タイトル"] || obj.project_title || obj["案件名"] || "",
    talent_title: obj["人材タイトル"] || obj.talent_title || obj["氏名"] || "",
    title: obj["案件タイトル"] || obj["案件名"] || obj.project_title || "",
    name: obj["人材タイトル"] || obj["氏名"] || obj.talent_title || "",
    project_info: obj["案件情報"] || obj.project_info || obj["詳細原文"] || "",
    talent_info: obj["人材情報"] || obj.talent_info || obj["詳細原文"] || ""
  };
}

function valueForHeader(item, header, dataType) {
  const h = normalizeHeader(header);

  const commonMap = {
    日時: ["captured_at", "取得日時", "取得日"],
    取得日時: ["captured_at", "取得日時", "取得日"],
    url: ["url", "URL"],
    rawtext: ["raw_text", "案件情報", "人材情報", "詳細原文"],
    uniquekey: ["unique_key", "一意キー", "id", "key"]
  };

  const projectMap = {
    日時: ["captured_at"],
    取得日時: ["captured_at"],
    案件タイトル: ["project_title", "title"],
    案件名: ["project_title", "title"],
    会社名: ["company_name"],
    優先度: ["priority"],
    単価: ["price_man", "unit_price"],
    "単価（万円）": ["price_man", "unit_price"],
    職種: ["job_type"],
    スキル: ["skill", "must_skill"],
    年齢制限: ["age_limit"],
    リモート: ["remote_condition", "remote"],
    商流制限: ["commercial_flow_limit", "commercial_flow"],
    個人事業主: ["sole_proprietor"],
    外国籍: ["foreign_nationality", "nationality"],
    都道府県: ["prefecture", "location"],
    開始時期: ["start_date"],
    案件情報: ["project_info", "raw_text"],
    URL: ["url"],
    一意キー: ["unique_key"]
  };

  const talentMap = {
    日時: ["captured_at"],
    取得日時: ["captured_at"],
    人材タイトル: ["talent_title", "name"],
    氏名: ["talent_title", "name"],
    会社名: ["company_name"],
    優先度: ["priority"],
    単価: ["price_man", "desired_unit_price"],
    "単価（万円）": ["price_man", "desired_unit_price"],
    希望単価: ["desired_unit_price", "price_man"],
    年齢: ["age"],
    所属: ["affiliation"],
    職種: ["job_type"],
    スキル: ["skill"],
    リモート条件: ["remote_condition", "remote"],
    国籍: ["nationality"],
    都道府県: ["prefecture", "location"],
    最寄駅: ["nearest_station"],
    開始時期: ["start_date", "available_from"],
    開始可能時期: ["available_from", "start_date"],
    人材情報: ["talent_info", "raw_text"],
    URL: ["url"],
    一意キー: ["unique_key"]
  };

  for (const [label, aliases] of Object.entries(commonMap)) {
    if (h === normalizeHeader(label)) return pickByAliases(item, aliases);
  }

  const map = dataType === "project" ? projectMap : talentMap;
  for (const [label, aliases] of Object.entries(map)) {
    if (h === normalizeHeader(label)) return pickByAliases(item, aliases);
  }

  return item[header] ?? item[h] ?? "";
}

export async function readObjects(spreadsheetId, sheetName) {
  const values = await getValues(spreadsheetId, `${sheetName}!A:ZZ`).catch(() => []);
  if (!values.length) return [];

  const [header, ...rows] = values;
  return rows.map((row) => {
    const obj = Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""]));
    return enrichReadObject(obj);
  });
}

export async function writeObjectsRespectingExistingHeader(
  spreadsheetId,
  sheetName,
  dataType,
  items,
  fallbackHeader
) {
  await ensureSheet(spreadsheetId, sheetName);

  const existing = await getValues(spreadsheetId, `${sheetName}!1:1`).catch(() => []);
  const header = existing[0]?.length ? existing[0] : fallbackHeader;

  const values = [
    header,
    ...items.map((item) => header.map((h) => valueForHeader(item, h, dataType)))
  ];

  await clearSheet(spreadsheetId, `${sheetName}!A:ZZ`);
  await updateValues(spreadsheetId, `${sheetName}!A1`, values);
}

export async function appendObjectsRespectingExistingHeader(
  spreadsheetId,
  sheetName,
  items,
  fallbackHeader
) {
  if (!items.length) return;

  await ensureSheet(spreadsheetId, sheetName);

  const existing = await getValues(spreadsheetId, `${sheetName}!1:1`).catch(() => []);
  const header = existing[0]?.length ? existing[0] : fallbackHeader;

  if (!existing[0]?.length) {
    await updateValues(spreadsheetId, `${sheetName}!A1`, [header]);
  }

  const values = items.map((item) =>
    header.map((h) => item[h] ?? item[normalizeHeader(h)] ?? item.unique_key ?? "")
  );

  await appendValues(spreadsheetId, `${sheetName}!A:A`, values);
}

export function buildDiffRows(beforeRows, afterRows, keyField, dataType) {
  const now = new Date().toISOString();

  const normalizeRowKey = (row) =>
    row[keyField] ||
    row.unique_key ||
    row["一意キー"] ||
    row.url ||
    row["URL"] ||
    [
      row.project_title || row["案件タイトル"] || "",
      row.talent_title || row["人材タイトル"] || "",
      row.project_info || row["案件情報"] || "",
      row.talent_info || row["人材情報"] || ""
    ]
      .filter(Boolean)
      .join("__")
      .slice(0, 500);

  const beforeMap = new Map(
    beforeRows
      .map((r) => [normalizeRowKey(r), r])
      .filter(([k]) => k)
  );

  const afterMap = new Map(
    afterRows
      .map((r) => [normalizeRowKey(r), r])
      .filter(([k]) => k)
  );

  const diffs = [];

  for (const [key, after] of afterMap.entries()) {
    const before = beforeMap.get(key);

    if (!before) {
      diffs.push({
        captured_at: now,
        data_type: dataType,
        diff_type: "new",
        unique_key: key,
        title: after.project_title || after.talent_title || after.title || after.name || "",
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
        title: after.project_title || after.talent_title || after.title || after.name || "",
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
        title:
          before.project_title ||
          before.talent_title ||
          before.title ||
          before.name ||
          before["案件タイトル"] ||
          before["人材タイトル"] ||
          "",
        url: before.url || before["URL"] || ""
      });
    }
  }

  return diffs;
}

export const DEFAULT_PROJECT_HEADER = [
  "日時",
  "案件タイトル",
  "会社名",
  "優先度",
  "単価（万円）",
  "職種",
  "スキル",
  "年齢制限",
  "リモート",
  "商流制限",
  "個人事業主",
  "外国籍",
  "都道府県",
  "開始時期",
  "案件情報"
];

export const DEFAULT_TALENT_HEADER = [
  "日時",
  "人材タイトル",
  "会社名",
  "優先度",
  "単価（万円）",
  "年齢",
  "所属",
  "職種",
  "スキル",
  "リモート条件",
  "国籍",
  "都道府県",
  "最寄駅",
  "開始時期",
  "人材情報"
];

export const DEFAULT_DIFF_HEADER = [
  "captured_at",
  "data_type",
  "diff_type",
  "unique_key",
  "title",
  "url"
];
