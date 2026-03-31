import {
  readObjects,
  writeObjectsRespectingExistingHeader,
  appendObjectsRespectingExistingHeader,
  buildDiffRows,
  DEFAULT_PROJECT_HEADER,
  DEFAULT_TALENT_HEADER,
  DEFAULT_DIFF_HEADER
} from './sheets.js';
import { scrapeChoTatsu } from './choTatsu.js';

const spreadsheetId = process.env.SPREADSHEET_ID;
if (!spreadsheetId) {
  throw new Error('SPREADSHEET_ID が未設定です');
}

async function main() {
  const prevProjects = await readObjects(spreadsheetId, 'projects_raw').catch(() => []);
  const prevTalents = await readObjects(spreadsheetId, 'talents_raw').catch(() => []);

  const { projects, talents } = await scrapeChoTatsu();

  await writeObjectsRespectingExistingHeader(
    spreadsheetId,
    'projects_raw',
    'project',
    projects,
    DEFAULT_PROJECT_HEADER
  );

  await writeObjectsRespectingExistingHeader(
    spreadsheetId,
    'talents_raw',
    'talent',
    talents,
    DEFAULT_TALENT_HEADER
  );

  const projectDiffs = buildDiffRows(prevProjects, projects, 'unique_key', 'project');
  const talentDiffs = buildDiffRows(prevTalents, talents, 'unique_key', 'talent');
  const diffs = [...projectDiffs, ...talentDiffs];

  if (diffs.length) {
    await appendObjectsRespectingExistingHeader(
      spreadsheetId,
      'daily_diff',
      diffs,
      DEFAULT_DIFF_HEADER
    );
  }

  console.log(`projects=${projects.length}`);
  console.log(`talents=${talents.length}`);
  console.log(`diffs=${diffs.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
