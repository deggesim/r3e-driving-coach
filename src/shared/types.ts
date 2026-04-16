/**
 * Shared types for R3E Voice Coach.
 * Used by both main process and renderer.
 */

// --- Alert System ---

export type AlertPriority = 1 | 2 | 3;

export type AlertType =
  | 'BRAKE_TEMP_CRITICAL'
  | 'TC_ANOMALY'
  | 'ABS_ANOMALY'
  | 'LATE_BRAKE'
  | 'SLOW_THROTTLE'
  | 'TRAIL_BRAKING'
  | 'COASTING'
  | 'BRAKE_THROTTLE_OVERLAP';

export type Alert = {
  type: AlertType;
  priority: AlertPriority;
  zone: number;
  dist: number;
  message: string;
  immediate: boolean;
  data?: Record<string, unknown>;
  timestamp: number;
};

// --- Deviation from baseline ---

export type DeviationType =
  | 'LATE_BRAKE'
  | 'SLOW_THROTTLE'
  | 'TRAIL_BRAKING'
  | 'COASTING'
  | 'BRAKE_THROTTLE_OVERLAP';

export type Deviation = {
  type: DeviationType;
  zone: number;
  dist: number;
  delta: number;
  message: string;
};

// --- Active game source ---

export type GameSource = 'r3e' | 'ace';

// --- Minimal frame interface used by RuleEngine and ZoneTracker ---

export interface GameFrame {
  lapDistance: number;   // metres from start line
  tcActive: number;      // 0 or 1
  absActive: number;     // 0 or 1
  brakeTempFL: number;   // °C, -1 if unavailable
  brakeTempFR: number;
  brakeTempRL: number;
  brakeTempRR: number;
}

// --- Frame (compact, from R3EReader) ---

export type CompactFrame = {
  d: number;       // lapDistance
  spd: number;     // speed km/h
  thr: number;     // throttle 0-1
  brk: number;     // brake 0-1
  str: number;     // steer input
  gear: number;
  abs: number;     // ABS active 0-1
  tc: number;      // TC active 0-1
  bt: number[];    // brake temps [FL, FR, RL, RR]
  ts: number;      // timestamp ms
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
};

// --- Lap Record ---

export type LapRecord = {
  lapNumber: number;
  lapTime: number;      // seconds
  sectorTimes: number[]; // [s1, s2, s3] seconds; [-1,-1,-1] if unavailable
  valid: boolean;
  game?: GameSource;    // source game; defaults to 'r3e' if absent
  car: string;          // numeric ID (R3E) or string slug (ACE), e.g. "6349" or "ks_porsche_718_gt4"
  track: string;        // numeric ID (R3E) or string slug (ACE)
  layout: string;       // numeric ID (R3E) or config string (ACE)
  carName?: string;     // resolved display name (R3E) or same as car (ACE)
  trackName?: string;   // resolved display name (R3E) or same as track (ACE)
  layoutName?: string;  // resolved display name (R3E) or same as layout (ACE)
  layoutLength: number; // meters
  frames: CompactFrame[];
  zones: ZoneData[];
  recordedAt: string;   // ISO timestamp
};

// --- R3E Connection Status ---

export type R3EStatus = {
  connected: boolean;
  calibrating: boolean;
  lapsToCalibration: number;
  car: string | null;
  track: string | null;
  layout: string | null;
  game: GameSource;
};

// --- Session & Lap (from SQLite) ---

export type SessionRow = {
  id: number;
  car: string;
  track: string;
  layout: string;
  session_type: string;
  started_at: string;
  best_lap: number | null;
  lap_count: number;
};

export type LapRow = {
  id: number;
  session_id: number;
  lap_number: number;
  lap_time: number;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
  valid: boolean;
  analysis_json: string | null;
  pdf_path: string | null;
  setup_json: string | null;
  setup_screenshots: string | null;
  recorded_at: string;
};

/** LapRow enriched with session info and resolved display names. */
export type LapRowFull = LapRow & {
  car: string;            // numeric ID from session (R3E) or slug (ACE)
  track: string;
  layout: string;
  game: GameSource;       // 'r3e' | 'ace'
  car_name: string;       // resolved display name
  track_name: string;
  layout_name: string;
  car_class_name: string; // resolved class name (may be empty)
};

// --- Setup decoding ---

export type SetupParam = {
  category: string;
  parameter: string;
  value: string;
};

export type SetupData = {
  carVerified: boolean;
  carFound: string;
  setupText: string;          // free-form markdown summary
  params: SetupParam[];       // structured list of parameters
  screenshots: string[];      // filenames used
};

// --- Analysis result from Claude API ---

export type LapAnalysis = {
  lapNumber: number;
  lapTime: number;
  templateV3: string;     // Full Template v3 markdown
  section5Summary: string; // Section [5] text for TTS
  generatedAt: string;
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
  carSpeed: number;       // km/h (converted from m/s)
  gear: number;
  engineRpm: number;      // converted from rad/s

  // Inputs
  throttle: number;       // 0-1
  brake: number;          // 0-1
  steerInput: number;

  // Aids
  absActive: number;      // 0-1
  tcActive: number;       // 0-1

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

export type ElectronAPI = {
  // Push channels (Main → Renderer)
  onFrame: (callback: (data: R3EFrame) => void) => void;
  onAlert: (callback: (data: Alert) => void) => void;
  onLapComplete: (callback: (data: LapRecord) => void) => void;
  onStatus: (callback: (data: R3EStatus) => void) => void;
  onAnalysis: (callback: (data: LapAnalysis) => void) => void;
  onVoiceChunk: (callback: (data: { token: string }) => void) => void;
  onVoiceDone: (callback: (data: { answer: string }) => void) => void;
  onVoiceAudio: (callback: (data: unknown) => void) => void;

  // Request/response
  getLaps: (params: { car: string; track: string }) => Promise<LapRow[]>;
  getAllLaps: () => Promise<LapRowFull[]>;
  getSession: (id: number) => Promise<SessionRow | null>;
  configGet: (key: string) => Promise<unknown>;
  configSet: (key: string, value: unknown) => Promise<void>;

  // Voice coach
  voiceQuery: (question: string) => Promise<void>;

  // Azure STT
  sttTranscribe: (audioBuffer: ArrayBuffer, mimeType?: string) => Promise<string>;

  // Azure TTS
  ttsGetVoices: () => Promise<AzureVoice[]>;
  ttsSynthesize: (text: string) => Promise<unknown>;
  ttsTest: (voiceName: string) => Promise<unknown>;

  // Window
  windowClose: () => void;
  windowMinimize: () => void;
  windowMaximize: () => void;
  removeAllListeners: (channel: string) => void;

  // R3E Setup analysis (screenshot-based)
  listScreenshots: () => Promise<Array<{ name: string; thumbnailB64: string }>>;
  decodeSetup: (params: { filenames: string[]; expectedCar: string }) => Promise<SetupData>;
  saveSetup: (params: { lapId: number; setup: SetupData }) => Promise<void>;
  exportPdf: (params: { lapId: number }) => Promise<string | null>;

  // ACE Setup analysis (file-based)
  aceListSetupFiles: (params: { car: string; track: string }) => Promise<Array<{ filename: string; filePath: string; modifiedAt: string }>>;
  aceReadSetup: (params: { filePath: string }) => Promise<SetupData>;
  exportPdfFromData: (params: {
    lapNumber: number;
    lapTime: number;
    sector1: number | null;
    sector2: number | null;
    sector3: number | null;
    car: string;
    track: string;
    layout: string;
    recordedAt: string;
    analysisJson: string | null;
    setupJson: string | null;
  }) => Promise<string | null>;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
