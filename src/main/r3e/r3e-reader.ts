/**
 * R3EReader — Opens R3E shared memory ($R3E) and polls at 16ms.
 *
 * Events:
 *   connected()                 — R3E shared memory found
 *   disconnected()              — R3E shared memory lost
 *   frame(data: R3EFrame)       — Every 16ms poll
 *   lapComplete(lapData)        — Lap boundary detected
 *   sectorComplete(n, time)     — Sector boundary detected
 *
 * Auto-enters mock mode on non-Windows or when { mock: true }.
 */

import { EventEmitter } from "events";
import { createRequire } from "module";
import {
  STRUCT_SIZE_KNOWN,
  SHM_NAME,
  VERSION_MAJOR,
  readInt32,
  readFloat,
  readDouble,
  readFloatArray,
  readString,
} from "./r3e-struct.js";
import {
  POLL_INTERVAL_MS,
  RECONNECT_INTERVAL_MS,
} from "../../shared/alert-types.js";
import type { R3EFrame, CompactFrame } from "../../shared/types.js";

const _require = createRequire(import.meta.url);

type R3EReaderOptions = {
  mock?: boolean;
};

// Windows kernel32 types (loaded dynamically via koffi)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativePointer = any; // koffi opaque pointer

type Kernel32 = {
  OpenFileMappingA: (
    access: number,
    inherit: number,
    name: string,
  ) => NativePointer;
  MapViewOfFile: (
    handle: NativePointer,
    access: number,
    offsetHigh: number,
    offsetLow: number,
    bytes: number,
  ) => NativePointer;
  UnmapViewOfFile: (addr: NativePointer) => boolean;
  CloseHandle: (handle: NativePointer) => boolean;
};

const FILE_MAP_READ = 0x0004;

export type R3EReader = {
  start: () => void;
  stop: () => void;
  on: EventEmitter["on"];
};

export const createR3EReader = (options: R3EReaderOptions = {}): R3EReader => {
  const emitter = new EventEmitter();
  const isMock = options.mock ?? process.platform !== "win32";

  let connected = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shmProbeCounter = 0;
  const SHM_PROBE_INTERVAL = 62; // ~1s at 16ms poll
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let koffi: any = null;
  let kernel32: Kernel32 | null = null;
  let mapHandle: NativePointer | null = null;
  let viewPtr: NativePointer | null = null;
  let stopped = false;

  const isNullPtr = (ptr: NativePointer): boolean => {
    if (ptr === null || ptr === undefined) return true;
    try {
      return koffi.address(ptr) === 0n;
    } catch {
      return false;
    }
  };

  let firstPoll = true; // log version on first successful poll
  let lastCompletedLaps = -1;
  let lastTrackSector = -1;
  let lapFrames: CompactFrame[] = [];
  let currentCar = "";
  let currentTrack = "";
  let currentLayout = "";
  let currentLayoutLength = 0;

  const cleanup = (): void => {
    if (kernel32 && viewPtr) kernel32.UnmapViewOfFile(viewPtr);
    if (kernel32 && mapHandle) kernel32.CloseHandle(mapHandle);
    viewPtr = null;
    mapHandle = null;
    if (connected) {
      connected = false;
      emitter.emit("disconnected");
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    reconnectTimer = setTimeout(() => tryConnect(), RECONNECT_INTERVAL_MS);
  };

  const parseFrame = (buf: Buffer): R3EFrame => {
    const carSpeed = readFloat(buf, "CarSpeed") * 3.6; // m/s → km/h
    const engineRpm = readFloat(buf, "EngineRps") * (60 / (2 * Math.PI)); // rad/s → RPM

    // BrakeTemp: TireData<BrakeTempInformation> — current temp is first field of each entry
    const brakeTempFL = readFloat(buf, "BrakeTemp_FL_Current");
    const brakeTempFR = readFloat(buf, "BrakeTemp_FR_Current");
    const brakeTempRL = readFloat(buf, "BrakeTemp_RL_Current");
    const brakeTempRR = readFloat(buf, "BrakeTemp_RR_Current");

    // TireTemp: TireData<TireTempInformation> — center tread temp (Left=0, Center=1, Right=2)
    const tireTempFL = readFloat(buf, "TireTemp_FL_Center");
    const tireTempFR = readFloat(buf, "TireTemp_FR_Center");
    const tireTempRL = readFloat(buf, "TireTemp_RL_Center");
    const tireTempRR = readFloat(buf, "TireTemp_RR_Center");

    // AidSettings: value 5 means aid is currently active
    const absActive = readInt32(buf, "AidSettings_Abs") === 5 ? 1 : 0;
    const tcActive = readInt32(buf, "AidSettings_Tc") === 5 ? 1 : 0;

    return {
      versionMajor: readInt32(buf, "VersionMajor"),
      versionMinor: readInt32(buf, "VersionMinor"),
      gamePaused: readInt32(buf, "GamePaused") !== 0,
      gameInMenus: readInt32(buf, "GameInMenus") !== 0,
      gameInReplay: readInt32(buf, "GameInReplay") !== 0,

      trackId: readInt32(buf, "TrackId"),
      layoutId: readInt32(buf, "LayoutId"),
      trackName: readString(buf, "TrackName", 64),
      layoutName: readString(buf, "LayoutName", 64),
      layoutLength: readFloat(buf, "LayoutLength"),
      sessionType: readInt32(buf, "SessionType"),
      sessionPhase: readInt32(buf, "SessionPhase"),

      completedLaps: readInt32(buf, "CompletedLaps"),
      currentLapValid: readInt32(buf, "CurrentLapValid") !== 0,
      trackSector: readInt32(buf, "TrackSector"),
      lapDistance: readFloat(buf, "LapDistance"),
      lapDistanceFraction: readFloat(buf, "LapDistanceFraction"),

      lapTimeBestSelf: readFloat(buf, "LapTimeBestSelf"),
      sectorTimesBestSelf: readFloatArray(buf, "SectorTimesBestSelf", 3),
      lapTimePreviousSelf: readFloat(buf, "LapTimePreviousSelf"),
      lapTimeCurrentSelf: readFloat(buf, "LapTimeCurrentSelf"),
      sectorTimesCurrentSelf: readFloatArray(buf, "SectorTimesCurrentSelf", 3),

      carModelId: readInt32(buf, "VehicleInfo_ModelId"),
      carName: readString(buf, "VehicleInfo_Name", 64),
      carSpeed,
      gear: readInt32(buf, "Gear"),
      engineRpm,

      throttle: readFloat(buf, "Throttle"),
      brake: readFloat(buf, "Brake"),
      steerInput: readFloat(buf, "SteerInputRaw"),

      absActive,
      tcActive,

      brakeTempFL,
      brakeTempFR,
      brakeTempRL,
      brakeTempRR,

      tireTempFL,
      tireTempFR,
      tireTempRL,
      tireTempRR,

      fuelLeft: readFloat(buf, "FuelLeft"),
      fuelCapacity: readFloat(buf, "FuelCapacity"),
      fuelPerLap: readFloat(buf, "FuelPerLap"),

      posX: readDouble(buf, "Player_Pos_X"),
      posY: readDouble(buf, "Player_Pos_Y"),
      posZ: readDouble(buf, "Player_Pos_Z"),

      inPitlane: readInt32(buf, "InPitlane") !== 0,
      flagsCheckered: readInt32(buf, "Flags_Checkered") !== 0,
    };
  };

  const detectBoundaries = (frame: R3EFrame): void => {
    if (frame.carModelId > 0) currentCar = String(frame.carModelId);
    if (frame.trackId > 0) currentTrack = String(frame.trackId);
    if (frame.layoutId > 0) currentLayout = String(frame.layoutId);
    if (frame.layoutLength > 0) currentLayoutLength = frame.layoutLength;

    if (!frame.gamePaused && !frame.gameInMenus && !frame.inPitlane) {
      lapFrames.push({
        d: frame.lapDistance,
        spd: frame.carSpeed,
        thr: frame.throttle,
        brk: frame.brake,
        str: frame.steerInput,
        gear: frame.gear,
        abs: frame.absActive,
        tc: frame.tcActive,
        bt: [
          frame.brakeTempFL,
          frame.brakeTempFR,
          frame.brakeTempRL,
          frame.brakeTempRR,
        ],
        ts: Date.now(),
      });
    }

    // Sector boundary
    if (frame.trackSector !== lastTrackSector && lastTrackSector >= 0) {
      const sectorTimes = frame.sectorTimesCurrentSelf;
      const completedSector = lastTrackSector;
      if (sectorTimes[completedSector] > 0) {
        emitter.emit(
          "sectorComplete",
          completedSector,
          sectorTimes[completedSector],
        );
      }
    }
    lastTrackSector = frame.trackSector;

    // Lap boundary
    if (frame.completedLaps !== lastCompletedLaps && lastCompletedLaps !== -1) {
      console.log(
        `[R3EReader] completedLaps changed: ${lastCompletedLaps} → ${frame.completedLaps}`,
      );
    }
    if (frame.completedLaps > lastCompletedLaps && lastCompletedLaps >= 0) {
      console.log(
        `[R3EReader] lapComplete — lap=${frame.completedLaps} lapTime=${frame.lapTimePreviousSelf.toFixed(3)}s ` +
          `valid=${frame.currentLapValid} car="${currentCar}" track="${currentTrack}" layout="${currentLayout}" ` +
          `layoutLength=${currentLayoutLength} frames=${lapFrames.length}`,
      );
      const lapData = {
        lapNumber: frame.completedLaps,
        lapTime: frame.lapTimePreviousSelf,
        sectorTimes: [...frame.sectorTimesCurrentSelf],
        frames: [...lapFrames],
        car: currentCar,
        track: currentTrack,
        layout: currentLayout,
        layoutLength: currentLayoutLength,
        valid: frame.currentLapValid,
      };
      lapFrames = [];
      emitter.emit("lapComplete", lapData);
    }
    lastCompletedLaps = frame.completedLaps;
  };

  const poll = (): void => {
    if (stopped || !viewPtr) return;

    // Periodically verify the named SHM object still exists.
    // We release our file-mapping handle before probing: if R3E has exited and
    // we were the last holder, the named object disappears and OpenFileMappingA
    // returns NULL. Keeping our handle open would keep the object alive and
    // make the probe always succeed even after R3E closes.
    if (++shmProbeCounter >= SHM_PROBE_INTERVAL) {
      shmProbeCounter = 0;
      if (mapHandle) {
        kernel32!.CloseHandle(mapHandle);
        mapHandle = null;
      }
      const probe = kernel32!.OpenFileMappingA(FILE_MAP_READ, 0, SHM_NAME);
      if (isNullPtr(probe)) {
        cleanup();
        scheduleReconnect();
        return;
      }
      mapHandle = probe;
    }

    try {
      const raw: Uint8Array = koffi.decode(
        viewPtr,
        koffi.array("uint8_t", STRUCT_SIZE_KNOWN),
      );
      const buf: Buffer = Buffer.from(
        raw.buffer,
        raw.byteOffset,
        raw.byteLength,
      );

      const versionMajor = readInt32(buf, "VersionMajor");
      const versionMinor = readInt32(buf, "VersionMinor");
      if (firstPoll || versionMajor !== VERSION_MAJOR) {
        console.log(
          `[R3EReader] poll — VersionMajor=${versionMajor} VersionMinor=${versionMinor} (expected major=${VERSION_MAJOR})`,
        );
        firstPoll = false;
      }
      if (versionMajor !== VERSION_MAJOR) {
        console.warn(
          `[R3EReader] version mismatch: got ${versionMajor}, expected ${VERSION_MAJOR} — disconnecting`,
        );
        cleanup();
        scheduleReconnect();
        return;
      }

      const frame = parseFrame(buf);
      emitter.emit("r3e:frame", frame);
      detectBoundaries(frame);
    } catch {
      cleanup();
      scheduleReconnect();
      return;
    }

    pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
  };

  const tryConnect = (): void => {
    if (stopped) return;

    try {
      if (!kernel32) {
        koffi = _require("koffi");
        const lib = koffi.load("kernel32.dll");

        kernel32 = {
          OpenFileMappingA: lib.func(
            "void* __stdcall OpenFileMappingA(uint32 dwDesiredAccess, int bInheritHandle, const char* lpName)",
          ),
          MapViewOfFile: lib.func(
            "void* __stdcall MapViewOfFile(void* hFileMappingObject, uint32 dwDesiredAccess, uint32 dwFileOffsetHigh, uint32 dwFileOffsetLow, size_t dwNumberOfBytesToMap)",
          ),
          UnmapViewOfFile: lib.func(
            "bool __stdcall UnmapViewOfFile(const void* lpBaseAddress)",
          ),
          CloseHandle: lib.func("bool __stdcall CloseHandle(void* hObject)"),
        } as Kernel32;
      }

      const handle = kernel32.OpenFileMappingA(FILE_MAP_READ, 0, SHM_NAME);
      if (isNullPtr(handle)) {
        scheduleReconnect();
        return;
      }

      const view = kernel32.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
      if (isNullPtr(view)) {
        kernel32.CloseHandle(handle);
        scheduleReconnect();
        return;
      }

      mapHandle = handle;
      viewPtr = view;
      connected = true;
      emitter.emit("connected");
      poll();
    } catch (err) {
      console.error("[R3EReader] tryConnect error:", err);
      scheduleReconnect();
    }
  };

  // --- Mock mode ---

  let mockLapDist = 0;
  let mockLapNumber = 0;
  let mockSector = 0;

  const generateMockFrame = (dist: number, trackLength: number): R3EFrame => {
    const fraction = dist / trackLength;
    const isBraking = [0.08, 0.25, 0.45, 0.65, 0.82].some(
      (bz) => Math.abs(fraction - bz) < 0.02,
    );

    return {
      versionMajor: 3,
      versionMinor: 0,
      gamePaused: false,
      gameInMenus: false,
      gameInReplay: false,
      trackId: 1683,
      layoutId: 1684,
      trackName: "Circuit Zolder",
      layoutName: "Grand Prix",
      layoutLength: trackLength,
      sessionType: 1,
      sessionPhase: 5,
      completedLaps: mockLapNumber,
      currentLapValid: true,
      trackSector: mockSector,
      lapDistance: dist,
      lapDistanceFraction: fraction,
      lapTimeBestSelf: 92.5,
      sectorTimesBestSelf: [30.1, 31.2, 31.2],
      lapTimePreviousSelf: 93.0,
      lapTimeCurrentSelf: fraction * 93,
      sectorTimesCurrentSelf: [30.1, 31.2, 31.2],
      carModelId: 6349,
      carName: "Porsche 911 GT3 R",
      carSpeed: isBraking ? 120 + Math.random() * 20 : 200 + Math.random() * 30,
      gear: isBraking ? 3 : 5,
      engineRpm: isBraking ? 5500 : 7200,
      throttle: isBraking ? 0 : 0.85 + Math.random() * 0.15,
      brake: isBraking ? 0.6 + Math.random() * 0.3 : 0,
      steerInput: (Math.random() - 0.5) * 0.3,
      absActive: isBraking ? (Math.random() > 0.7 ? 1 : 0) : 0,
      tcActive: !isBraking ? (Math.random() > 0.9 ? 1 : 0) : 0,
      brakeTempFL: 520 + Math.random() * 80,
      brakeTempFR: 525 + Math.random() * 80,
      brakeTempRL: 420 + Math.random() * 60,
      brakeTempRR: 415 + Math.random() * 60,
      tireTempFL: 90 + Math.random() * 10,
      tireTempFR: 92 + Math.random() * 10,
      tireTempRL: 88 + Math.random() * 8,
      tireTempRR: 87 + Math.random() * 8,
      fuelLeft: 80,
      fuelCapacity: 110,
      fuelPerLap: 3.2,
      posX: Math.cos(fraction * Math.PI * 2) * 500,
      posY: 0,
      posZ: Math.sin(fraction * Math.PI * 2) * 500,
      inPitlane: false,
      flagsCheckered: false,
    };
  };

  const generateMockFrames = (trackLength: number): CompactFrame[] => {
    const frames: CompactFrame[] = [];
    for (let d = 0; d < trackLength; d += 30) {
      const fraction = d / trackLength;
      const isBraking = [0.08, 0.25, 0.45, 0.65, 0.82].some(
        (bz) => Math.abs(fraction - bz) < 0.02,
      );
      frames.push({
        d,
        spd: isBraking ? 120 + Math.random() * 20 : 200 + Math.random() * 30,
        thr: isBraking ? 0 : 0.85 + Math.random() * 0.15,
        brk: isBraking ? 0.6 + Math.random() * 0.3 : 0,
        str: (Math.random() - 0.5) * 0.3,
        gear: isBraking ? 3 : 5,
        abs: isBraking ? (Math.random() > 0.7 ? 1 : 0) : 0,
        tc: !isBraking ? (Math.random() > 0.9 ? 1 : 0) : 0,
        bt: [
          520 + Math.random() * 80,
          525 + Math.random() * 80,
          420 + Math.random() * 60,
          415 + Math.random() * 60,
        ],
        ts: Date.now(),
      });
    }
    return frames;
  };

  const pollMock = (): void => {
    if (stopped) return;

    const trackLength = 4011; // Zolder GP length
    mockLapDist += 30; // ~30m per 16ms at ~175km/h

    if (mockLapDist >= trackLength) {
      mockLapDist -= trackLength;
      mockLapNumber++;

      const lapData = {
        lapNumber: mockLapNumber,
        lapTime: 92.5 + Math.random() * 3,
        sectorTimes: [30.1, 31.2, 31.2],
        frames: generateMockFrames(trackLength),
        car: "6349",
        track: "1683",
        layout: "1684",
        layoutLength: trackLength,
        valid: true,
      };
      emitter.emit("lapComplete", lapData);
    }

    const newSector =
      mockLapDist < trackLength * 0.33
        ? 0
        : mockLapDist < trackLength * 0.66
          ? 1
          : 2;
    if (newSector !== mockSector) {
      emitter.emit("r3e:sectorComplete", mockSector, 30 + Math.random() * 2);
      mockSector = newSector;
    }

    const frame = generateMockFrame(mockLapDist, trackLength);
    emitter.emit("r3e:frame", frame);

    pollTimer = setTimeout(() => pollMock(), POLL_INTERVAL_MS);
  };

  const startMock = (): void => {
    connected = true;
    emitter.emit("connected");
    console.log("[R3EReader] Mock mode active");
    pollMock();
  };

  return {
    start: () => {
      stopped = false;
      if (isMock) startMock();
      else tryConnect();
    },

    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanup();
    },

    on: emitter.on.bind(emitter),
  };
};
