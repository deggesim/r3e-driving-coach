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

import { EventEmitter } from 'events';
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
} from './ace-struct';
import {
  POLL_INTERVAL_MS,
  RECONNECT_INTERVAL_MS,
} from '../../shared/alert-types';
import type { GameFrame, CompactFrame } from '../../shared/types';

type AceReaderOptions = {
  mock?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativePointer = any;

type Kernel32 = {
  OpenFileMappingA: (access: number, inherit: number, name: string) => NativePointer;
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

export type AceReader = {
  start: () => void;
  stop: () => void;
  on: EventEmitter['on'];
};

export const createAceReader = (options: AceReaderOptions = {}): AceReader => {
  const emitter = new EventEmitter();
  const isMock = options.mock ?? process.platform !== 'win32';

  let connected = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
  let lastTotalLapCount = -1;

  // Session static cache (read once on connect)
  let cachedTrack = '';
  let cachedLayout = '';
  let cachedTrackLength = 0;
  let cachedCarModel = ''; // last seen car model from GraphicEvo

  const isNullPtr = (ptr: NativePointer): boolean => {
    if (ptr === null || ptr === undefined) return true;
    try {
      return koffi.address(ptr) === 0n;
    } catch {
      return false;
    }
  };

  const ptrStr = (ptr: NativePointer): string => {
    try {
      return `0x${koffi.address(ptr).toString(16)}`;
    } catch {
      return String(ptr);
    }
  };

  const cleanup = (): void => {
    if (kernel32) {
      if (physView)  kernel32.UnmapViewOfFile(physView);
      if (gfxView)   kernel32.UnmapViewOfFile(gfxView);
      if (staView)   kernel32.UnmapViewOfFile(staView);
      if (physHandle) kernel32.CloseHandle(physHandle);
      if (gfxHandle)  kernel32.CloseHandle(gfxHandle);
      if (staHandle)  kernel32.CloseHandle(staHandle);
    }
    physView = physHandle = null;
    gfxView  = gfxHandle  = null;
    staView  = staHandle  = null;
    if (connected) {
      connected = false;
      emitter.emit('disconnected');
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    reconnectTimer = setTimeout(() => tryConnect(), RECONNECT_INTERVAL_MS);
  };

  /** Read StaticEvo once to populate session-level cache. */
  const readStatic = (buf: Buffer): void => {
    cachedTrack  = readString(buf, STA.track, 33);
    cachedLayout = readString(buf, STA.trackConfiguration, 33);
    cachedTrackLength = readFloat(buf, STA.trackLengthM);
    const smVer  = readString(buf, STA.smVersion, 15);
    const aceVer = readString(buf, STA.acEvoVersion, 15);
    console.log(
      `[AceReader] StaticEvo — smVersion="${smVer}" aceVersion="${aceVer}" ` +
      `track="${cachedTrack}" layout="${cachedLayout}" length=${cachedTrackLength}m`,
    );
  };

  const decodeBuffer = (view: NativePointer, size: number): Buffer => {
    const raw: Uint8Array = koffi.decode(view, koffi.array('uint8_t', size));
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  };

  const poll = (): void => {
    if (stopped || !physView || !gfxView || !staView) return;

    try {
      const gfxBuf  = decodeBuffer(gfxView,  ACE_GRAPHIC_BUF);
      const status  = readInt32(gfxBuf, GFX.status);

      if (firstPoll) {
        console.log(
          `[AceReader] first poll — status=${status} (AC_LIVE=${AC_LIVE}) ` +
          `npos=${readFloat(gfxBuf, GFX.npos).toFixed(4)} ` +
          `totalLapCount=${readInt32(gfxBuf, GFX.totalLapCount)}`,
        );
        firstPoll = false;
      }

      // Only process when game is live (not in menus, replay, or paused)
      if (status !== AC_LIVE) {
        pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
        return;
      }

      const physBuf = decodeBuffer(physView,  ACE_PHYSICS_BUF);

      // --- Physics fields ---
      const gas        = readFloat(physBuf, PHY.gas);
      const brake      = readFloat(physBuf, PHY.brake);
      const gear       = readInt32(physBuf, PHY.gear);
      const steerAngle = readFloat(physBuf, PHY.steerAngle);
      const speedKmh   = readFloat(physBuf, PHY.speedKmh);
      const brakeTempArr = readFloatArray(physBuf, PHY.brakeTemp, 4);
      const tcinAction = readInt32(physBuf, PHY.tcinAction);
      const absInAction = readInt32(physBuf, PHY.absInAction);

      // --- Graphic fields ---
      const tcActive   = readUint8(gfxBuf, GFX.tcActive);
      const absActive  = readUint8(gfxBuf, GFX.absActive);
      const npos       = readFloat(gfxBuf,  GFX.npos);
      const isValidLap = readUint8(gfxBuf, GFX.isValidLap) !== 0;
      const isInPitLane = readUint8(gfxBuf, GFX.isInPitLane) !== 0;
      const totalLapCount = readInt32(gfxBuf, GFX.totalLapCount);
      const lastLaptimeMs = readInt32(gfxBuf, GFX.lastLaptimeMs);
      const carModel   = readString(gfxBuf, GFX.carModel, 33);

      // Update cached car model when available
      if (carModel.length > 0) cachedCarModel = carModel;

      // Compute lap distance from normalised position
      const lapDistance = npos * cachedTrackLength;

      // Build GameFrame
      const gameFrame: GameFrame = {
        lapDistance,
        tcActive:   tcActive  > 0 || tcinAction  > 0 ? 1 : 0,
        absActive:  absActive > 0 || absInAction > 0 ? 1 : 0,
        brakeTempFL: brakeTempArr[0] ?? -1,
        brakeTempFR: brakeTempArr[1] ?? -1,
        brakeTempRL: brakeTempArr[2] ?? -1,
        brakeTempRR: brakeTempArr[3] ?? -1,
      };

      emitter.emit('frame', gameFrame);

      // Accumulate CompactFrame (exclude pit lane frames)
      if (!isInPitLane) {
        lapFrames.push({
          d:    lapDistance,
          spd:  speedKmh,
          thr:  gas,
          brk:  brake,
          str:  steerAngle,
          gear,
          abs:  gameFrame.absActive,
          tc:   gameFrame.tcActive,
          bt:   [...brakeTempArr],
          ts:   Date.now(),
        });
      }

      // Lap completion: totalLapCount incremented
      if (totalLapCount > lastTotalLapCount && lastTotalLapCount >= 0) {
        const lapTime = lastLaptimeMs > 0 ? lastLaptimeMs / 1000 : 0;
        console.log(
          `[AceReader] lapComplete — lap=${totalLapCount} lapTime=${lapTime.toFixed(3)}s ` +
          `valid=${isValidLap} car="${cachedCarModel}" track="${cachedTrack}" ` +
          `layout="${cachedLayout}" length=${cachedTrackLength}m frames=${lapFrames.length}`,
        );
        const lapData = {
          lapNumber:    totalLapCount,
          lapTime,
          sectorTimes:  [-1, -1, -1] as [number, number, number],
          frames:       [...lapFrames],
          car:          cachedCarModel,
          track:        cachedTrack,
          layout:       cachedLayout,
          layoutLength: cachedTrackLength,
          valid:        isValidLap,
        };
        lapFrames = [];
        emitter.emit('lapComplete', lapData);
      }
      lastTotalLapCount = totalLapCount;

    } catch (err) {
      console.error('[AceReader] poll error:', err);
      cleanup();
      scheduleReconnect();
      return;
    }

    pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
  };

  const openSHM = (name: string): { handle: NativePointer; view: NativePointer } | null => {
    const handle = kernel32!.OpenFileMappingA(FILE_MAP_READ, 0, name);
    console.log(`[AceReader] OpenFileMappingA("${name}") → handle=${ptrStr(handle)}`);
    if (isNullPtr(handle)) return null;

    const view = kernel32!.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
    console.log(`[AceReader] MapViewOfFile("${name}") → view=${ptrStr(view)}`);
    if (isNullPtr(view)) {
      kernel32!.CloseHandle(handle);
      return null;
    }
    return { handle, view };
  };

  const tryConnect = (): void => {
    if (stopped) return;
    console.log(`[AceReader] tryConnect — platform=${process.platform}`);

    try {
      if (!kernel32) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        koffi = require('koffi');
        const lib = koffi.load('kernel32.dll');
        console.log('[AceReader] kernel32.dll loaded');

        kernel32 = {
          OpenFileMappingA: lib.func(
            'void* __stdcall OpenFileMappingA(uint32 dwDesiredAccess, int bInheritHandle, const char* lpName)',
          ),
          MapViewOfFile: lib.func(
            'void* __stdcall MapViewOfFile(void* hFileMappingObject, uint32 dwDesiredAccess, uint32 dwFileOffsetHigh, uint32 dwFileOffsetLow, size_t dwNumberOfBytesToMap)',
          ),
          UnmapViewOfFile: lib.func('bool __stdcall UnmapViewOfFile(const void* lpBaseAddress)'),
          CloseHandle: lib.func('bool __stdcall CloseHandle(void* hObject)'),
          GetLastError: lib.func('uint32 __stdcall GetLastError()'),
        } as Kernel32;
      }

      // Physics page
      const phy = openSHM(ACE_SHM_PHYSICS);
      if (!phy) {
        console.log('[AceReader] Physics SHM not available — game not running?');
        scheduleReconnect();
        return;
      }
      physHandle = phy.handle;
      physView   = phy.view;
      console.log(`[AceReader] Physics SHM opened as "${ACE_SHM_PHYSICS}"`);

      // Graphic page
      const gfx = openSHM(ACE_SHM_GRAPHIC);
      if (!gfx) {
        console.log('[AceReader] Graphic SHM not available');
        kernel32.UnmapViewOfFile(physView);
        kernel32.CloseHandle(physHandle);
        physView = physHandle = null;
        scheduleReconnect();
        return;
      }
      gfxHandle = gfx.handle;
      gfxView   = gfx.view;

      // Static page
      const sta = openSHM(ACE_SHM_STATIC);
      if (!sta) {
        console.log('[AceReader] Static SHM not available');
        kernel32.UnmapViewOfFile(physView);  kernel32.CloseHandle(physHandle);
        kernel32.UnmapViewOfFile(gfxView);   kernel32.CloseHandle(gfxHandle);
        physView = physHandle = gfxView = gfxHandle = null;
        scheduleReconnect();
        return;
      }
      staHandle = sta.handle;
      staView   = sta.view;

      // Read static data once
      const staBuf = decodeBuffer(staView, ACE_STATIC_BUF);
      readStatic(staBuf);

      connected = true;
      emitter.emit('connected');
      poll();

    } catch (err) {
      console.error('[AceReader] tryConnect error:', err);
      scheduleReconnect();
    }
  };

  // ── Mock mode ────────────────────────────────────────────────────────────────

  let mockLapDist = 0;
  let mockLapNumber = 0;

  const MOCK_TRACK_LENGTH = 5793; // Monza GP
  const MOCK_TRACK = 'monza';
  const MOCK_LAYOUT = 'monza_full';
  const MOCK_CAR = 'ks_porsche_718_gt4';

  const generateMockGameFrame = (dist: number): GameFrame => {
    const fraction = dist / MOCK_TRACK_LENGTH;
    const isBraking = [0.08, 0.22, 0.38, 0.55, 0.75].some(
      (bz) => Math.abs(fraction - bz) < 0.015,
    );
    return {
      lapDistance: dist,
      tcActive:  !isBraking && Math.random() > 0.92 ? 1 : 0,
      absActive: isBraking  && Math.random() > 0.72 ? 1 : 0,
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
        tc:  !isBraking && Math.random() > 0.9 ? 1 : 0,
        bt: [
          500 + Math.random() * 120,
          505 + Math.random() * 120,
          410 + Math.random() * 70,
          405 + Math.random() * 70,
        ],
        ts: Date.now(),
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
        lapNumber:    mockLapNumber,
        lapTime:      99.5 + Math.random() * 4,
        sectorTimes:  [-1, -1, -1] as [number, number, number],
        frames:       generateMockLapFrames(),
        car:          MOCK_CAR,
        track:        MOCK_TRACK,
        layout:       MOCK_LAYOUT,
        layoutLength: MOCK_TRACK_LENGTH,
        valid:        true,
      };
      emitter.emit('lapComplete', lapData);
    }

    const frame = generateMockGameFrame(mockLapDist);
    emitter.emit('frame', frame);

    pollTimer = setTimeout(() => pollMock(), POLL_INTERVAL_MS);
  };

  const startMock = (): void => {
    connected = true;
    cachedTrack       = MOCK_TRACK;
    cachedLayout      = MOCK_LAYOUT;
    cachedTrackLength = MOCK_TRACK_LENGTH;
    cachedCarModel    = MOCK_CAR;
    emitter.emit('connected');
    console.log('[AceReader] Mock mode active');
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
  };
};
