/**
 * AceReader — Opens ACE shared memory (three pages) and polls at 16ms.
 *
 * Events:
 *   connected()                          — ACE shared memory found
 *   disconnected()                       — ACE shared memory lost
 *   frame(data: GameFrame)               — Every 16ms poll (only when AC_LIVE)
 *   lapComplete(lapData)                 — Lap boundary detected
 *
 * Auto-enters mock mode on non-Windows or when { mock: true }.
 *
 * Notes:
 *  - Sector times are NOT available in ACE SHM → always [-1, -1, -1]
 *  - Car/track IDs are readable strings (e.g. "ks_porsche_718_gt4", "monza")
 *  - StaticEvo is read once on connect for track/car/layout/length caching
 *  - Status must be AC_LIVE (2) before any telemetry is processed
 */

import { EventEmitter } from "events";
import { createRequire } from "module";
import {
  ACE_SHM_PHYSICS,
  ACE_SHM_GRAPHIC,
  ACE_SHM_STATIC,
  ACE_PHYSICS_BUF,
  ACE_GRAPHIC_BUF,
  ACE_STATIC_BUF,
  AC_LIVE,
  PHY,
  GFX,
  STA,
  readInt32,
  readFloat,
  readUint8,
  readString,
  readFloatArray,
} from "./ace-struct.js";
import {
  POLL_INTERVAL_MS,
  RECONNECT_INTERVAL_MS,
} from "../../shared/alert-types.js";
import type { GameFrame, CompactFrame } from "../../shared/types.js";

const _require = createRequire(import.meta.url);

type AceReaderOptions = {
  mock?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativePointer = any;

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
  GetLastError: () => number;
};

const FILE_MAP_READ = 0x0004;

export type AceSessionInfo = {
  car: string;
  track: string;
  layout: string;
  trackLength: number;
};

export type AceReader = {
  start: () => void;
  stop: () => void;
  on: EventEmitter["on"];
  getSessionInfo: () => AceSessionInfo;
};

export const createAceReader = (options: AceReaderOptions = {}): AceReader => {
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

  // Three SHM handles/views
  let physHandle: NativePointer | null = null;
  let physView: NativePointer | null = null;
  let gfxHandle: NativePointer | null = null;
  let gfxView: NativePointer | null = null;
  let staHandle: NativePointer | null = null;
  let staView: NativePointer | null = null;

  let stopped = false;
  let firstPoll = true;

  // Per-lap state
  let lapFrames: CompactFrame[] = [];
  let ownLapCount = 0;
  let prevNpos = -1;
  let prevCurrentLapTimeMs = 0;
  let prevIsValidLap = true;
  // Cumulative world-space distance: makes CompactFrame.d consistent with wx/wz
  // so the telemetry chart cursor and track map marker are perfectly aligned.
  let cumulativeDist = 0;
  let lastFrameWx: number | undefined;
  let lastFrameWz: number | undefined;

  // Session static cache (read once on connect)
  let cachedTrack = "";
  let cachedLayout = "";
  let cachedTrackLength = 0;
  let cachedCarModel = ""; // last seen car model from GraphicEvo

  const isNullPtr = (ptr: NativePointer): boolean => {
    if (ptr === null || ptr === undefined) return true;
    try {
      return koffi.address(ptr) === 0n;
    } catch {
      return false;
    }
  };

  const cleanup = (): void => {
    if (kernel32) {
      if (physView) kernel32.UnmapViewOfFile(physView);
      if (gfxView) kernel32.UnmapViewOfFile(gfxView);
      if (staView) kernel32.UnmapViewOfFile(staView);
      if (physHandle) kernel32.CloseHandle(physHandle);
      if (gfxHandle) kernel32.CloseHandle(gfxHandle);
      if (staHandle) kernel32.CloseHandle(staHandle);
    }
    physView = physHandle = null;
    gfxView = gfxHandle = null;
    staView = staHandle = null;
    if (connected) {
      connected = false;
      lapFrames = [];
      ownLapCount = 0;
      prevNpos = -1;
      prevCurrentLapTimeMs = 0;
      prevIsValidLap = true;
      emitter.emit("disconnected");
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    reconnectTimer = setTimeout(() => tryConnect(), RECONNECT_INTERVAL_MS);
  };

  /** Read StaticEvo once to populate session-level cache. */
  const readStatic = (buf: Buffer): void => {
    cachedTrack = readString(buf, STA.track, 33);
    cachedLayout = readString(buf, STA.trackConfiguration, 33);
    cachedTrackLength = readFloat(buf, STA.trackLengthM);
    const smVer = readString(buf, STA.smVersion, 15);
    const aceVer = readString(buf, STA.acEvoVersion, 15);
    console.log(
      `[AceReader] StaticEvo — smVersion="${smVer}" aceVersion="${aceVer}" ` +
        `track="${cachedTrack}" layout="${cachedLayout}" length=${cachedTrackLength}m`,
    );
  };

  const decodeBuffer = (view: NativePointer, size: number): Buffer => {
    const raw: Uint8Array = koffi.decode(view, koffi.array("uint8_t", size));
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  };

  const poll = (): void => {
    if (stopped || !physView || !gfxView || !staView) return;

    // Periodically verify ACE SHM still exists by releasing and re-acquiring
    // the physics handle. If ACE has exited and we were the last holder, the
    // named object disappears and OpenFileMappingA returns NULL.
    if (++shmProbeCounter >= SHM_PROBE_INTERVAL) {
      shmProbeCounter = 0;
      if (physHandle) {
        kernel32!.CloseHandle(physHandle);
        physHandle = null;
      }
      const probe = kernel32!.OpenFileMappingA(
        FILE_MAP_READ,
        0,
        ACE_SHM_PHYSICS,
      );
      if (isNullPtr(probe)) {
        cleanup();
        scheduleReconnect();
        return;
      }
      physHandle = probe;
    }

    try {
      const gfxBuf = decodeBuffer(gfxView, ACE_GRAPHIC_BUF);
      const status = readInt32(gfxBuf, GFX.status);

      // Car model is readable even when paused — update cache opportunistically
      const carModelEarly = readString(gfxBuf, GFX.carModel, 33);
      if (carModelEarly.length > 0) cachedCarModel = carModelEarly;

      if (firstPoll) {
        const wx = readFloat(gfxBuf, GFX.carCoordinates + 0 * 4);
        const wy = readFloat(gfxBuf, GFX.carCoordinates + 1 * 4);
        const wz = readFloat(gfxBuf, GFX.carCoordinates + 2 * 4);
        console.log(
          `[AceReader] first poll — status=${status} (AC_LIVE=${AC_LIVE}) ` +
            `npos=${readFloat(gfxBuf, GFX.npos).toFixed(4)} car="${cachedCarModel}" ` +
            `worldPos=[${wx.toFixed(1)}, ${wy.toFixed(1)}, ${wz.toFixed(1)}]`,
        );
        firstPoll = false;
      }

      // Only process when game is live (not in menus, replay, or paused)
      if (status !== AC_LIVE) {
        pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
        return;
      }

      // Re-read static if track length not yet known (game may have been in menus at connect)
      if (cachedTrackLength === 0 && staView) {
        const staBuf2 = decodeBuffer(staView, ACE_STATIC_BUF);
        readStatic(staBuf2);
      }

      const physBuf = decodeBuffer(physView, ACE_PHYSICS_BUF);

      // --- Physics fields ---
      const gas = readFloat(physBuf, PHY.gas);
      const brake = readFloat(physBuf, PHY.brake);
      const gear = readInt32(physBuf, PHY.gear);
      const rpm = readInt32(physBuf, PHY.rpms);
      const steerAngle = readFloat(physBuf, PHY.steerAngle);
      const speedKmh = readFloat(physBuf, PHY.speedKmh);
      const brakeTempArr = readFloatArray(physBuf, PHY.brakeTemp, 4);
      const accG = readFloatArray(physBuf, PHY.accG, 3);
      const wheelsPressure = readFloatArray(physBuf, PHY.wheelsPressure, 4);
      const suspensionTravel = readFloatArray(physBuf, PHY.suspensionTravel, 4);
      const slipRatio = readFloatArray(physBuf, PHY.slipRatio, 4);
      const tcinAction = readInt32(physBuf, PHY.tcinAction);
      const absInAction = readInt32(physBuf, PHY.absInAction);

      // --- Graphic fields ---
      const tcActive = readUint8(gfxBuf, GFX.tcActive);
      const absActive = readUint8(gfxBuf, GFX.absActive);
      const npos = readFloat(gfxBuf, GFX.npos);
      const isValidLap = readUint8(gfxBuf, GFX.isValidLap) !== 0;
      const isInPitLane = readUint8(gfxBuf, GFX.isInPitLane) !== 0;
      const currentLapTimeMs = readInt32(gfxBuf, GFX.currentLapTimeMs);
      const lastLaptimeMs = readInt32(gfxBuf, GFX.lastLaptimeMs);
      const carModel = readString(gfxBuf, GFX.carModel, 33);

      // Player world position (singleplayer: index 0 of car_coordinates[60][3])
      const playerWx = readFloat(gfxBuf, GFX.carCoordinates + 0 * 4);
      const playerWy = readFloat(gfxBuf, GFX.carCoordinates + 1 * 4);
      const playerWz = readFloat(gfxBuf, GFX.carCoordinates + 2 * 4);

      // Update cached car model when available
      if (carModel.length > 0) cachedCarModel = carModel;

      // Compute lap distance from normalised position
      const lapDistance = npos * cachedTrackLength;

      // Build GameFrame
      const gameFrame: GameFrame = {
        lapDistance,
        tcActive: tcActive > 0 || tcinAction > 0 ? 1 : 0,
        absActive: absActive > 0 || absInAction > 0 ? 1 : 0,
        brakeTempFL: brakeTempArr[0] ?? -1,
        brakeTempFR: brakeTempArr[1] ?? -1,
        brakeTempRL: brakeTempArr[2] ?? -1,
        brakeTempRR: brakeTempArr[3] ?? -1,
      };

      emitter.emit("ace:frame", gameFrame);

      // Advance cumulative world-space distance on every poll (including pit lane),
      // so the d value in CompactFrame is always derived from the same wx/wz that
      // is stored in the frame, eliminating the npos-vs-carCoordinates lag.
      if (lastFrameWx !== undefined && lastFrameWz !== undefined) {
        const dx = playerWx - lastFrameWx;
        const dz = playerWz - lastFrameWz;
        cumulativeDist += Math.sqrt(dx * dx + dz * dz);
      }
      lastFrameWx = playerWx;
      lastFrameWz = playerWz;

      // Accumulate CompactFrame (exclude pit lane frames)
      if (!isInPitLane) {
        lapFrames.push({
          d: cumulativeDist,
          spd: speedKmh,
          thr: gas,
          brk: brake,
          str: steerAngle,
          gear,
          abs: gameFrame.absActive,
          tc: gameFrame.tcActive,
          bt: [...brakeTempArr],
          ts: Date.now(),
          rpm,
          gLat: accG[0],
          gLon: accG[2],
          tp: [...wheelsPressure],
          sr: [...slipRatio],
          sus: [...suspensionTravel],
          wx: playerWx,
          wy: playerWy,
          wz: playerWz,
        });
      }

      // Lap completion: npos crosses start/finish (0.85→1.0 → 0.0→0.15).
      // This is more reliable than totalLapCount whose SHM offset is uncertain.
      if (prevNpos > 0.85 && npos < 0.15 && prevNpos >= 0) {
        ownLapCount++;
        const lapTime =
          prevCurrentLapTimeMs > 0
            ? prevCurrentLapTimeMs / 1000
            : lastLaptimeMs > 0
              ? lastLaptimeMs / 1000
              : 0;
        console.log(
          `[AceReader] lapComplete — lap=${ownLapCount} lapTime=${lapTime.toFixed(3)}s ` +
            `valid=${prevIsValidLap} car="${cachedCarModel}" track="${cachedTrack}" ` +
            `layout="${cachedLayout}" length=${cachedTrackLength}m frames=${lapFrames.length}`,
        );
        const lapData = {
          lapNumber: ownLapCount,
          lapTime,
          sectorTimes: [-1, -1, -1] as [number, number, number],
          frames: [...lapFrames],
          car: cachedCarModel,
          track: cachedTrack,
          layout: cachedLayout,
          layoutLength: cachedTrackLength,
          valid: prevIsValidLap,
        };
        lapFrames = [];
        cumulativeDist = 0;
        lastFrameWx = undefined;
        lastFrameWz = undefined;
        emitter.emit("lapComplete", lapData);
      }
      prevNpos = npos;
      prevCurrentLapTimeMs = currentLapTimeMs;
      prevIsValidLap = isValidLap;
    } catch (err) {
      console.error("[AceReader] poll error:", err);
      cleanup();
      scheduleReconnect();
      return;
    }

    pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
  };

  const openSHM = (
    name: string,
  ): { handle: NativePointer; view: NativePointer } | null => {
    const handle = kernel32!.OpenFileMappingA(FILE_MAP_READ, 0, name);
    if (isNullPtr(handle)) return null;

    const view = kernel32!.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
    if (isNullPtr(view)) {
      kernel32!.CloseHandle(handle);
      return null;
    }
    return { handle, view };
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
          GetLastError: lib.func("uint32 __stdcall GetLastError()"),
        } as Kernel32;
      }

      // Physics page
      const phy = openSHM(ACE_SHM_PHYSICS);
      if (!phy) {
        scheduleReconnect();
        return;
      }
      physHandle = phy.handle;
      physView = phy.view;

      // Graphic page
      const gfx = openSHM(ACE_SHM_GRAPHIC);
      if (!gfx) {
        kernel32.UnmapViewOfFile(physView);
        kernel32.CloseHandle(physHandle);
        physView = physHandle = null;
        scheduleReconnect();
        return;
      }
      gfxHandle = gfx.handle;
      gfxView = gfx.view;

      // Static page
      const sta = openSHM(ACE_SHM_STATIC);
      if (!sta) {
        kernel32.UnmapViewOfFile(physView);
        kernel32.CloseHandle(physHandle);
        kernel32.UnmapViewOfFile(gfxView);
        kernel32.CloseHandle(gfxHandle);
        physView = physHandle = gfxView = gfxHandle = null;
        scheduleReconnect();
        return;
      }
      staHandle = sta.handle;
      staView = sta.view;

      // Read static data once
      const staBuf = decodeBuffer(staView, ACE_STATIC_BUF);
      readStatic(staBuf);

      connected = true;
      emitter.emit("connected");
      poll();
    } catch (err) {
      console.error("[AceReader] tryConnect error:", err);
      scheduleReconnect();
    }
  };

  // ── Mock mode ────────────────────────────────────────────────────────────────

  let mockLapDist = 0;
  let mockLapNumber = 0;

  const MOCK_TRACK_LENGTH = 5793; // Monza GP
  const MOCK_TRACK = "monza";
  const MOCK_LAYOUT = "monza_full";
  const MOCK_CAR = "ks_porsche_718_gt4";

  const generateMockGameFrame = (dist: number): GameFrame => {
    const fraction = dist / MOCK_TRACK_LENGTH;
    const isBraking = [0.08, 0.22, 0.38, 0.55, 0.75].some(
      (bz) => Math.abs(fraction - bz) < 0.015,
    );
    return {
      lapDistance: dist,
      tcActive: !isBraking && Math.random() > 0.92 ? 1 : 0,
      absActive: isBraking && Math.random() > 0.72 ? 1 : 0,
      brakeTempFL: 500 + Math.random() * 120,
      brakeTempFR: 505 + Math.random() * 120,
      brakeTempRL: 410 + Math.random() * 70,
      brakeTempRR: 405 + Math.random() * 70,
    };
  };

  const generateMockLapFrames = (): CompactFrame[] => {
    const frames: CompactFrame[] = [];
    for (let d = 0; d < MOCK_TRACK_LENGTH; d += 30) {
      const fraction = d / MOCK_TRACK_LENGTH;
      const isBraking = [0.08, 0.22, 0.38, 0.55, 0.75].some(
        (bz) => Math.abs(fraction - bz) < 0.015,
      );
      frames.push({
        d,
        spd: isBraking ? 110 + Math.random() * 30 : 190 + Math.random() * 50,
        thr: isBraking ? 0 : 0.85 + Math.random() * 0.15,
        brk: isBraking ? 0.5 + Math.random() * 0.4 : 0,
        str: (Math.random() - 0.5) * 0.25,
        gear: isBraking ? 3 : 6,
        abs: isBraking && Math.random() > 0.7 ? 1 : 0,
        tc: !isBraking && Math.random() > 0.9 ? 1 : 0,
        bt: [
          500 + Math.random() * 120,
          505 + Math.random() * 120,
          410 + Math.random() * 70,
          405 + Math.random() * 70,
        ],
        ts: Date.now(),
        wx: Math.cos(fraction * Math.PI * 2) * 800,
        wy: 0,
        wz: Math.sin(fraction * Math.PI * 2) * 800,
      });
    }
    return frames;
  };

  const pollMock = (): void => {
    if (stopped) return;

    mockLapDist += 30; // ~30m per 16ms at ~175 km/h

    if (mockLapDist >= MOCK_TRACK_LENGTH) {
      mockLapDist -= MOCK_TRACK_LENGTH;
      mockLapNumber++;

      const lapData = {
        lapNumber: mockLapNumber,
        lapTime: 99.5 + Math.random() * 4,
        sectorTimes: [-1, -1, -1] as [number, number, number],
        frames: generateMockLapFrames(),
        car: MOCK_CAR,
        track: MOCK_TRACK,
        layout: MOCK_LAYOUT,
        layoutLength: MOCK_TRACK_LENGTH,
        valid: true,
      };
      emitter.emit("lapComplete", lapData);
    }

    const frame = generateMockGameFrame(mockLapDist);
    emitter.emit("ace:frame", frame);

    pollTimer = setTimeout(() => pollMock(), POLL_INTERVAL_MS);
  };

  const startMock = (): void => {
    connected = true;
    cachedTrack = MOCK_TRACK;
    cachedLayout = MOCK_LAYOUT;
    cachedTrackLength = MOCK_TRACK_LENGTH;
    cachedCarModel = MOCK_CAR;
    emitter.emit("connected");
    console.log("[AceReader] Mock mode active");
    pollMock();
  };

  // ── Public API ───────────────────────────────────────────────────────────────

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

    getSessionInfo: (): AceSessionInfo => ({
      car: cachedCarModel,
      track: cachedTrack,
      layout: cachedLayout,
      trackLength: cachedTrackLength,
    }),
  };
};
