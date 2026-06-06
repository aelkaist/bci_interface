import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TIME_ZONE = "Asia/Seoul";
const PILOTS = [
  { id: "pilot1", label: "Pilot 1 - 2026-05-24", date: "2026-05-24" },
  { id: "pilot2", label: "Pilot 2 - 2026-06-04", date: "2026-06-04" },
  { id: "pilot3", label: "Pilot 3 - 2026-06-05", date: "2026-06-05" },
];

const dashboardDir = path.resolve(__dirname, "../analysis/dashboard");
const inputPath = path.join(dashboardDir, "data.json");
const outputDir = path.join(dashboardDir, "data");
const sourceMapsDir = path.join(__dirname, "src/maps");
const replayAssetsDir = path.join(dashboardDir, "seeds");

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getLocalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

function getFirstDate(item, fields) {
  for (const field of fields) {
    const localDate = getLocalDate(item?.[field]);
    if (localDate) return localDate;
  }
  return null;
}

function filterParticipantForDate(participant, pilot) {
  const sessions = (participant.sessions || []).filter(
    (session) =>
      getFirstDate(session, [
        "mainStartedAt",
        "tutorialStartedAt",
        "updatedAt",
        "mainEndedAt",
      ]) === pilot.date,
  );

  if (sessions.length === 0) return null;

  const episodes = (participant.episodes || [])
    .filter(
      (episode) =>
        getFirstDate(episode, ["createdAt"]) === pilot.date,
    )
    .map((episode) => ({
      ...episode,
      feedbackItems: (episode.feedbackItems || []).filter(
        (item) => getFirstDate(item, ["createdAt"]) === pilot.date,
      ),
    }));

  const postSurveys = (participant.postSurveys || []).filter(
    (survey) => getFirstDate(survey, ["createdAt"]) === pilot.date,
  );

  return {
    ...participant,
    pilotSetId: pilot.id,
    pilotDate: pilot.date,
    sessions,
    episodes,
    feedbackItems: episodes.flatMap((episode) => episode.feedbackItems),
    postSurveys,
  };
}

function splitPilotData(allParticipants, pilot) {
  return Object.fromEntries(
    Object.entries(allParticipants)
      .map(([participantId, participant]) => [
        participantId,
        filterParticipantForDate(participant, pilot),
      ])
      .filter(([, participant]) => participant !== null),
  );
}

function normalizeReplayPath(fileName) {
  const candidate = String(fileName || "").replaceAll("\\", "/");
  const normalized = path.posix.normalize(candidate);

  if (
    !candidate ||
    path.posix.isAbsolute(candidate) ||
    candidate.split("/").includes("..") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.extname(normalized).toLowerCase() !== ".json"
  ) {
    throw new Error(`Invalid replay file path: ${fileName}`);
  }

  return normalized;
}

function collectReplayPaths(pilotOutputs) {
  const replayPaths = new Set();

  for (const { pilotData } of pilotOutputs) {
    for (const participant of Object.values(pilotData)) {
      for (const episode of participant.episodes || []) {
        if (episode.fileName) {
          replayPaths.add(normalizeReplayPath(episode.fileName));
        }
        for (const item of episode.feedbackItems || []) {
          if (item.fileName) {
            replayPaths.add(normalizeReplayPath(item.fileName));
          }
        }
      }
    }
  }

  return [...replayPaths].sort();
}

function filesMatch(firstPath, secondPath) {
  const firstStat = fs.statSync(firstPath);
  const secondStat = fs.statSync(secondPath);

  if (firstStat.size !== secondStat.size) return false;
  return fs.readFileSync(firstPath).equals(fs.readFileSync(secondPath));
}

function syncReplayAssets(replayPaths) {
  fs.mkdirSync(replayAssetsDir, { recursive: true });

  let copied = 0;
  let updated = 0;
  let reusedLegacy = 0;
  const missingSources = [];

  for (const replayPath of replayPaths) {
    const sourcePath = path.join(sourceMapsDir, replayPath);
    const destinationPath = path.join(replayAssetsDir, replayPath);
    const legacyPath = path.join(replayAssetsDir, path.basename(replayPath));

    if (!fs.existsSync(sourcePath)) {
      const isLegacyPilotPath = replayPath.split("/").length === 2;
      if (
        isLegacyPilotPath &&
        legacyPath !== destinationPath &&
        fs.existsSync(legacyPath)
      ) {
        reusedLegacy += 1;
        continue;
      }
      missingSources.push(replayPath);
      continue;
    }

    if (fs.existsSync(destinationPath)) {
      if (!filesMatch(sourcePath, destinationPath)) {
        fs.copyFileSync(sourcePath, destinationPath);
        updated += 1;
      }
      continue;
    }

    // Older dashboard assets were flattened into seeds/. Reuse an exact
    // basename match, but preserve directories for new assets to avoid
    // collisions between difficulty levels.
    if (
      legacyPath !== destinationPath &&
      fs.existsSync(legacyPath) &&
      filesMatch(sourcePath, legacyPath)
    ) {
      reusedLegacy += 1;
      continue;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    copied += 1;
  }

  if (missingSources.length > 0) {
    throw new Error(
      `Missing ${missingSources.length} replay source file(s):\n` +
        missingSources.map((fileName) => `- ${fileName}`).join("\n"),
    );
  }

  console.log(
    `Replay assets: ${replayPaths.length} referenced, ${copied} copied, ` +
      `${updated} updated, ${reusedLegacy} reused from legacy flat files`,
  );
}

if (!fs.existsSync(inputPath)) {
  console.error(`Could not find dashboard data at ${inputPath}`);
  process.exit(1);
}

const allParticipants = JSON.parse(fs.readFileSync(inputPath, "utf8"));
fs.mkdirSync(outputDir, { recursive: true });

const pilotOutputs = PILOTS.map((pilot) => ({
  pilot,
  pilotData: splitPilotData(allParticipants, pilot),
}));

syncReplayAssets(collectReplayPaths(pilotOutputs));

const manifest = {
  generatedAt: new Date().toISOString(),
  timeZone: TIME_ZONE,
  pilots: [],
};

for (const { pilot, pilotData } of pilotOutputs) {
  const file = `${pilot.id}-${pilot.date}.json`;
  const outputPath = path.join(outputDir, file);
  const participants = Object.values(pilotData);
  const completedParticipants = participants.filter((participant) =>
    participant.sessions.some((session) => session.status === "completed"),
  ).length;

  fs.writeFileSync(outputPath, JSON.stringify(pilotData, null, 2));
  manifest.pilots.push({
    ...pilot,
    file,
    participantCount: participants.length,
    completedParticipantCount: completedParticipants,
  });

  console.log(
    `${pilot.label}: ${participants.length} participants (${completedParticipants} completed)`,
  );
}

const manifestPath = path.join(outputDir, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Saved pilot files and manifest to ${outputDir}`);
