/**
 * Shared types for R3E Voice Coach.
 * Used by both main process and renderer.
 */

// --- Alert System ---

export type AlertPriority = 1 | 2 | 3;

export type AlertType =
  | "BRAKE_TEMP_CRITICAL"
  | "TC_ANOMALY"
  | "ABS_ANOMALY"
  | "LATE_BRAKE"
  | "SLOW_THROTTLE"
  | "TRAIL_BRAKING"
  | "COASTING"
  | "BRAKE_THROTTLE_OVERLAP";

export type Alert = {
  type: AlertType;
  priority: AlertPriority;
  zone: number;
  dist: number;
  lap: number;
  message: string;
  immediate: boolean;
  data?: Record<string, unknown>;
  timestamp: number;
};

// --- Deviation from baseline ---

export type DeviationType =
  | "LATE_BRAKE"
  | "SLOW_THROTTLE"
  | "TRAIL_BRAKING"
  | "COASTING"
  | "BRAKE_THROTTLE_OVERLAP";

export type Deviation = {
  type: DeviationType;
  zone: number;
  dist: number;
  delta: number;
  message: string;
};

// --- Active game source ---

export type GameSource = "r3e" | "ace";

// --- Minimal frame interface used by RuleEngine and ZoneTracker ---

export interface GameFrame {
  lapDistance: number; // metres from start line
  tcActive: number; // 0 or 1
  absActive: number; // 0 or 1
  brakeTempFL: number; // °C, -1 if unavailable
  brakeTempFR: number;
  brakeTempRL: number;
  brakeTempRR: number;
}

// --- Frame (compact, from R3EReader) ---

export type CompactFrame = {
  d: number; // lapDistance
  spd: number; // speed km/h
  thr: number; // throttle 0-1
  brk: number; // brake 0-1
  str: number; // steer input
  gear: number;
  abs: number; // ABS active 0-1
  tc: number; // TC active 0-1
  bt: number[]; // brake temps [FL, FR, RL, RR]
  ts: number; // timestamp ms
  // Extended fields (ACE only; undefined for R3E frames)
  rpm?: number; // engine RPM
  gLat?: number; // lateral G-force (accG[0])
  gLon?: number; // longitudinal G-force (accG[2])
  tp?: number[]; // tyre pressures PSI [FL, FR, RL, RR]
  sr?: number[]; // slip ratios [FL, FR, RL, RR]
  sus?: number[]; // suspension travel m [FL, FR, RL, RR]
  // World-space position (metres) — used for track-map rendering
  wx?: number;
  wy?: number;
  wz?: number;
};

// --- Track map geometry (cached per game/car/track/layout) ---

export type TrackMapBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type TrackMapGeometry = {
  svgPath: string; // "M x0 z0 L x1 z1 ..." in world coordinates
  bounds: TrackMapBounds;
  sampleCount: number;
  layoutLength: number;
};

export type TrackMapRow = {
  game: GameSource;
  car: string;
  track: string;
  layout: string;
  geometry: TrackMapGeometry;
  created_at: string;
};

// --- Zone aggregate (from LapRecorder) ---

export type ZoneData = {
  zone: number;
  dist: number;
  avgSpeedKmh: number;
  minSpeedKmh: number;
  maxBrakePct: number;
  avgThrottlePct: number;
  maxSteerAbs: number;
  steerDuringBrake: number;
  brakeFrames: number;
  throttleFrames: number;
  coastFrames: number;
  overlapFrames: number;
  tcActivations: number;
  absActivations: number;
  brakeStartDist: number | null;
  brakeEndDist: number | null;
  throttlePickupDist: number | null;
  // Extended (ACE only; present when source frames have the fields)
  avgRpm?: number;
  maxGLat?: number; // peak lateral G-force magnitude
  maxGLon?: number; // peak longitudinal G-force magnitude (braking)
  avgTyrePressure?: [number, number, number, number]; // PSI FL/FR/RL/RR
  avgSlipRatio?: [number, number, number, number]; // FL/FR/RL/RR
  avgSuspTravel?: [number, number, number, number]; // m FL/FR/RL/RR
};

// --- Lap Record ---

export type LapRecord = {
  lapNumber: number;
  lapTime: number; // seconds
  sectorTimes: number[]; // [s1, s2, s3] seconds; [-1,-1,-1] if unavailable
  valid: boolean;
  game?: GameSource; // source game; defaults to "r3e" if absent
  car: string; // numeric ID (R3E) or string slug (ACE), e.g. "6349" or "ks_porsche_718_gt4"
  track: string; // numeric ID (R3E) or string slug (ACE)
  layout: string; // numeric ID (R3E) or config string (ACE)
  carName?: string; // resolved display name (R3E) or same as car (ACE)
  trackName?: string; // resolved display name (R3E) or same as track (ACE)
  layoutName?: string; // resolved display name (R3E) or same as layout (ACE)
  layoutLength: number; // meters
  frames: CompactFrame[];
  zones: ZoneData[];
  recordedAt: string; // ISO timestamp
};

// --- R3E Connection Status ---

export type GameStatus = {
  connected: boolean;       // true if at least one game is connected
  r3eConnected: boolean;
  aceConnected: boolean;
  calibrating: boolean;
  lapsToCalibration: number;
  car: string | null;
  track: string | null;
  layout: string | null;
  game: GameSource;         // currently active game
};

// --- Session & Lap (from SQLite) ---

export type SessionRow = {
  id: number;
  game: GameSource;
  car: string;
  track: string;
  layout: string;
  session_type: string;
  started_at: string;
  ended_at: string | null;
  best_lap: number | null;
  lap_count: number;
  // Resolved display names (populated by queries)
  car_name?: string;
  track_name?: string;
  layout_name?: string;
  car_class_name?: string;
  analysis_count?: number;
};

export type LapRow = {
  id: number;
  session_id: number;
  setup_id: number | null;
  lap_number: number;
  lap_time: number;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
  valid: boolean;
  zones_json: string | null;
  recorded_at: string;
};

export type SessionSetupRow = {
  id: number;
  session_id: number;
  loaded_at: string;
  setup: SetupData;
  setup_screenshots: string | null;
};

export type SessionAnalysisRow = {
  id: number;
  session_id: number;
  version: number;
  template_v3: string;
  section5_summary: string | null;
  created_at: string;
};

export type SessionDetail = {
  session: SessionRow;
  laps: LapRow[];
  setups: SessionSetupRow[];
  analyses: SessionAnalysisRow[];
};

// --- Setup decoding ---

export type SetupParam = {
  category: string;
  parameter: string;
  value: string;
};

export type SetupData = {
  name?: string; // display name for the setup (filename for ACE, carFound for R3E)
  carVerified: boolean;
  carFound: string;
  setupText: string; // free-form markdown summary
  params: SetupParam[]; // structured list of parameters
  screenshots: string[]; // filenames used
};

// --- Parsed frame from R3E shared memory (full) ---

export type R3EFrame = {
  versionMajor: number;
  versionMinor: number;
  gamePaused: boolean;
  gameInMenus: boolean;
  gameInReplay: boolean;

  // Session
  trackId: number;
  layoutId: number;
  trackName: string;
  layoutName: string;
  layoutLength: number;
  sessionType: number;
  sessionPhase: number;

  // Lap
  completedLaps: number;
  currentLapValid: boolean;
  trackSector: number;
  lapDistance: number;
  lapDistanceFraction: number;

  // Timing
  lapTimeBestSelf: number;
  sectorTimesBestSelf: number[];
  lapTimePreviousSelf: number;
  lapTimeCurrentSelf: number;
  sectorTimesCurrentSelf: number[];

  // Vehicle
  carModelId: number;
  carName: string;
  carSpeed: number; // km/h (converted from m/s)
  gear: number;
  engineRpm: number; // converted from rad/s

  // Inputs
  throttle: number; // 0-1
  brake: number; // 0-1
  steerInput: number;

  // Aids
  absActive: number; // 0-1
  tcActive: number; // 0-1

  // Temps
  brakeTempFL: number;
  brakeTempFR: number;
  brakeTempRL: number;
  brakeTempRR: number;

  // Tires
  tireTempFL: number;
  tireTempFR: number;
  tireTempRL: number;
  tireTempRR: number;

  // Fuel
  fuelLeft: number;
  fuelCapacity: number;
  fuelPerLap: number;

  // Position
  posX: number;
  posY: number;
  posZ: number;

  // Flags
  inPitlane: boolean;
  flagsCheckered: boolean;
};

// --- Corner name seed data ---

export type CornerEntry = {
  distMin: number;
  distMax: number;
  name: string;
};

export type CornerNamesMap = Record<string, CornerEntry[]>;

// --- Azure TTS voice info ---

export type AzureVoice = {
  Name: string;
  DisplayName: string;
  LocalName: string;
  ShortName: string;
  Gender: "Female" | "Male";
  Locale: string;
  LocaleName: string;
  SecondaryLocaleList?: string[];
  SampleRateHertz: string;
  VoiceType: string;
  Status: string;
  VoiceTag?: {
    ModelSeries?: string[];
    Source?: string[];
    TailoredScenarios?: string[];
    VoicePersonalities?: string[];
  };
};

// --- electronAPI exposed via preload ---

export type SessionStartResult =
  | { ok: true; sessionId: number; game: GameSource }
  | { ok: false; reason: string };

export type SessionListParams = {
  page?: number;
  pageSize?: number;
  game?: GameSource | null;
  car?: string | null;
  track?: string | null;
  sort?: "asc" | "desc";
};

export type SessionListResult = {
  items: SessionRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type ElectronAPI = {
  // Push channels (Main → Renderer)
  onFrame: (callback: (data: R3EFrame) => void) => void;
  onLapComplete: (callback: (data: LapRecord) => void) => void;
  onStatus: (callback: (data: GameStatus) => void) => void;
  onVoiceChunk: (callback: (data: { token: string }) => void) => void;
  onVoiceDone: (callback: (data: { answer: string }) => void) => void;
  onVoiceAudio: (callback: (data: unknown) => void) => void;

  // Session push channels
  onSessionStarted: (callback: (data: SessionRow) => void) => void;
  onSessionClosed: (callback: (data: { id: number; game: GameSource }) => void) => void;
  onSessionLapAdded: (callback: (data: { sessionId: number; game: GameSource; lap: LapRow }) => void) => void;
  onSessionSetupLoaded: (callback: (data: { sessionId: number; game: GameSource; setup: SessionSetupRow }) => void) => void;
  onSessionAnalysisChunk: (callback: (data: { sessionId: number; version: number; token: string }) => void) => void;
  onSessionAnalysisDone: (callback: (data: { sessionId: number; analysis: SessionAnalysisRow }) => void) => void;

  // Config
  configGet: (key: string) => Promise<unknown>;
  configSet: (key: string, value: unknown) => Promise<void>;

  // Session lifecycle
  sessionStart: () => Promise<SessionStartResult>;
  sessionEnd: () => Promise<void>;
  sessionAnalyze: (params?: { sessionId?: number; game?: GameSource }) => Promise<{ ok: boolean; reason?: string }>;
  sessionLoadSetup: (params: { setup: SetupData }) => Promise<{ setupId: number }>;
  sessionList: (params: SessionListParams) => Promise<SessionListResult>;
  sessionGetCurrent: () => Promise<SessionDetail | null>;
  sessionGetDetail: (params: { id: number; game: GameSource }) => Promise<SessionDetail | null>;
  sessionExportPdf: (params: { id: number; game: GameSource }) => Promise<string | null>;
  sessionDelete: (params: { id: number; game: GameSource }) => Promise<void>;
  sessionDeleteAll: (items: Array<{ id: number; game: GameSource }>) => Promise<void>;
  sessionReopen: (params: { id: number; game: GameSource }) => Promise<SessionStartResult>;
  sessionGetSetupHistory: (params: { car: string; track: string; layout: string; game: GameSource }) => Promise<SessionSetupRow[]>;
  sessionReuseSetup: (params: { setupId: number }) => Promise<void>;

  // Lap telemetry frames (on demand)
  lapGetFrames: (params: { id: number; game: GameSource }) => Promise<CompactFrame[]>;

  // Track map geometry (cached per game/car/track/layout)
  trackMapGet: (params: {
    game: GameSource;
    car: string;
    track: string;
    layout: string;
  }) => Promise<TrackMapGeometry | null>;

  // Voice coach
  voiceQuery: (question: string) => Promise<void>;

  // Azure STT
  sttTranscribe: (
    audioBuffer: ArrayBuffer,
    mimeType?: string,
  ) => Promise<string>;

  // Azure TTS
  ttsGetVoices: () => Promise<AzureVoice[]>;
  ttsSynthesize: (text: string) => Promise<unknown>;
  ttsTest: (voiceName: string) => Promise<unknown>;

  // Window
  windowClose: () => void;
  windowMinimize: () => void;
  windowMaximize: () => void;
  removeAllListeners: (channel: string) => void;

  // ACE Setup analysis (file-based)
  aceListSetupCars: () => Promise<string[]>;
  aceListSetupTracks: (params: { car: string }) => Promise<string[]>;
  aceListSetupFiles: (params: {
    car: string;
    track: string;
  }) => Promise<
    Array<{ filename: string; filePath: string; modifiedAt: string }>
  >;
  aceReadSetup: (params: { filePath: string }) => Promise<SetupData>;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
