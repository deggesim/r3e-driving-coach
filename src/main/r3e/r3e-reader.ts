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

import { EventEmitter } from 'events';
import {
  STRUCT_SIZE_KNOWN,
  SHM_NAME,
  VERSION_MAJOR,
  readInt32,
  readFloat,
  readDouble,
  readFloatArray,
  readString,
} from './r3e-struct';
import { POLL_INTERVAL_MS, RECONNECT_INTERVAL_MS } from '../../shared/alert-types';
import type { R3EFrame, CompactFrame } from '../../shared/types';

type R3EReaderOptions = {
  mock?: boolean;
};

// Windows kernel32 types (loaded dynamically via ffi-napi)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativePointer = any; // ref-napi pointer type with .isNull(), .deref(), etc.

type Kernel32 = {
  OpenFileMappingA: (access: number, inherit: boolean, name: string) => NativePointer;
  MapViewOfFile: (handle: NativePointer, access: number, offsetHigh: number, offsetLow: number, bytes: number) => NativePointer;
  UnmapViewOfFile: (addr: NativePointer) => boolean;
  CloseHandle: (handle: NativePointer) => boolean;
};

const BUFFER_SIZE = 1024 * 1024; // 1MB
const FILE_MAP_READ = 0x0004;

export class R3EReader extends EventEmitter {
  private connected = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private kernel32: Kernel32 | null = null;
  private mapHandle: NativePointer | null = null;
  private viewPtr: NativePointer | null = null;
  private isMock: boolean;
  private lastCompletedLaps = -1;
  private lastTrackSector = -1;
  private lapFrames: CompactFrame[] = [];
  private currentCar = '';
  private currentTrack = '';
  private currentLayout = '';
  private currentLayoutLength = 0;
  private stopped = false;

  constructor(options: R3EReaderOptions = {}) {
    super();
    this.isMock = options.mock ?? process.platform !== 'win32';
  }

  start(): void {
    this.stopped = false;
    if (this.isMock) {
      this.startMock();
    } else {
      this.tryConnect();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
  }

  private tryConnect(): void {
    if (this.stopped) return;

    try {
      if (!this.kernel32) {
        // Dynamic import of ffi-napi (native module)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ffi = require('ffi-napi');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ref = require('ref-napi');

        this.kernel32 = ffi.Library('kernel32', {
          OpenFileMappingA: [ref.types.void_ptr, ['uint32', 'bool', 'string']],
          MapViewOfFile: [ref.types.void_ptr, [ref.types.void_ptr, 'uint32', 'uint32', 'uint32', 'size_t']],
          UnmapViewOfFile: ['bool', [ref.types.void_ptr]],
          CloseHandle: ['bool', [ref.types.void_ptr]],
        }) as Kernel32;
      }

      const handle = this.kernel32.OpenFileMappingA(FILE_MAP_READ, false, SHM_NAME);
      if (handle.isNull()) {
        this.scheduleReconnect();
        return;
      }

      const view = this.kernel32.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, BUFFER_SIZE);
      if (view.isNull()) {
        this.kernel32.CloseHandle(handle);
        this.scheduleReconnect();
        return;
      }

      this.mapHandle = handle;
      this.viewPtr = view;
      this.connected = true;
      this.emit('connected');
      this.poll();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => this.tryConnect(), RECONNECT_INTERVAL_MS);
  }

  private cleanup(): void {
    if (this.kernel32 && this.viewPtr) {
      this.kernel32.UnmapViewOfFile(this.viewPtr);
    }
    if (this.kernel32 && this.mapHandle) {
      this.kernel32.CloseHandle(this.mapHandle);
    }
    this.viewPtr = null;
    this.mapHandle = null;
    if (this.connected) {
      this.connected = false;
      this.emit('disconnected');
    }
  }

  private poll(): void {
    if (this.stopped || !this.viewPtr) return;

    try {
      // Read shared memory into a Buffer
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ref = require('ref-napi');
      const buf: Buffer = ref.reinterpret(this.viewPtr, STRUCT_SIZE_KNOWN, 0);

      const versionMajor = readInt32(buf, 'VersionMajor');
      if (versionMajor !== VERSION_MAJOR) {
        // R3E might have closed
        this.cleanup();
        this.scheduleReconnect();
        return;
      }

      const frame = this.parseFrame(buf);
      this.emit('frame', frame);

      // Detect lap/sector boundaries
      this.detectBoundaries(frame);

    } catch {
      this.cleanup();
      this.scheduleReconnect();
      return;
    }

    this.pollTimer = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
  }

  private parseFrame(buf: Buffer): R3EFrame {
    const carSpeed = readFloat(buf, 'CarSpeed') * 3.6; // m/s → km/h
    const engineRpm = readFloat(buf, 'EngineRps') * (60 / (2 * Math.PI)); // rad/s → RPM
    const brakeTempEst = readFloatArray(buf, 'BrakeTempActualEstimate', 4);
    const tireTempCenter = readFloatArray(buf, 'TireTempCenter', 4);

    return {
      versionMajor: readInt32(buf, 'VersionMajor'),
      versionMinor: readInt32(buf, 'VersionMinor'),
      gamePaused: readInt32(buf, 'GamePaused') !== 0,
      gameInMenus: readInt32(buf, 'GameInMenus') !== 0,
      gameInReplay: readInt32(buf, 'GameInReplay') !== 0,

      trackId: readInt32(buf, 'TrackId'),
      layoutId: readInt32(buf, 'LayoutId'),
      trackName: readString(buf, 'TrackName', 64),
      layoutName: readString(buf, 'LayoutName', 64),
      layoutLength: readFloat(buf, 'LayoutLength'),
      sessionType: readInt32(buf, 'SessionType'),
      sessionPhase: readInt32(buf, 'SessionPhase'),

      completedLaps: readInt32(buf, 'CompletedLaps'),
      currentLapValid: readInt32(buf, 'CurrentLapValid') !== 0,
      trackSector: readInt32(buf, 'TrackSector'),
      lapDistance: readFloat(buf, 'LapDistance'),
      lapDistanceFraction: readFloat(buf, 'LapDistanceFraction'),

      lapTimeBestSelf: readFloat(buf, 'LapTimeBestSelf'),
      sectorTimesBestSelf: readFloatArray(buf, 'SectorTimesBestSelf', 3),
      lapTimePreviousSelf: readFloat(buf, 'LapTimePreviousSelf'),
      lapTimeCurrentSelf: readFloat(buf, 'LapTimeCurrentSelf'),
      sectorTimesCurrentSelf: readFloatArray(buf, 'SectorTimesCurrentSelf', 3),

      carModelId: readInt32(buf, 'VehicleInfo_ModelId'),
      carName: readString(buf, 'VehicleInfo_Name', 64),
      carSpeed,
      gear: readInt32(buf, 'Gear'),
      engineRpm,

      throttle: readFloat(buf, 'Throttle'),
      brake: readFloat(buf, 'Brake'),
      steerInput: readFloat(buf, 'SteerInputRaw'),

      absActive: readFloat(buf, 'AidAbsActive'),
      tcActive: readFloat(buf, 'AidTcActive'),

      brakeTempFL: brakeTempEst[0],
      brakeTempFR: brakeTempEst[1],
      brakeTempRL: brakeTempEst[2],
      brakeTempRR: brakeTempEst[3],

      tireTempFL: tireTempCenter[0],
      tireTempFR: tireTempCenter[1],
      tireTempRL: tireTempCenter[2],
      tireTempRR: tireTempCenter[3],

      fuelLeft: readFloat(buf, 'FuelLeft'),
      fuelCapacity: readFloat(buf, 'FuelCapacity'),
      fuelPerLap: readFloat(buf, 'FuelPerLap'),

      posX: readDouble(buf, 'Player_Pos_X'),
      posY: readDouble(buf, 'Player_Pos_Y'),
      posZ: readDouble(buf, 'Player_Pos_Z'),

      inPitlane: readInt32(buf, 'InPitlane') !== 0,
      flagsCheckered: readInt32(buf, 'Flags_Checkered') !== 0,
    };
  }

  private detectBoundaries(frame: R3EFrame): void {
    // Update car/track info
    if (frame.carName) this.currentCar = frame.carName;
    if (frame.trackName) this.currentTrack = frame.trackName;
    if (frame.layoutName) this.currentLayout = frame.layoutName;
    if (frame.layoutLength > 0) this.currentLayoutLength = frame.layoutLength;

    // Collect compact frame
    if (!frame.gamePaused && !frame.gameInMenus && !frame.inPitlane) {
      this.lapFrames.push({
        d: frame.lapDistance,
        spd: frame.carSpeed,
        thr: frame.throttle,
        brk: frame.brake,
        str: frame.steerInput,
        gear: frame.gear,
        abs: frame.absActive,
        tc: frame.tcActive,
        bt: [frame.brakeTempFL, frame.brakeTempFR, frame.brakeTempRL, frame.brakeTempRR],
        ts: Date.now(),
      });
    }

    // Sector boundary
    if (frame.trackSector !== this.lastTrackSector && this.lastTrackSector >= 0) {
      const sectorTimes = frame.sectorTimesCurrentSelf;
      const completedSector = this.lastTrackSector;
      if (sectorTimes[completedSector] > 0) {
        this.emit('sectorComplete', completedSector, sectorTimes[completedSector]);
      }
    }
    this.lastTrackSector = frame.trackSector;

    // Lap boundary
    if (frame.completedLaps > this.lastCompletedLaps && this.lastCompletedLaps >= 0) {
      const lapData = {
        lapNumber: frame.completedLaps,
        lapTime: frame.lapTimePreviousSelf,
        sectorTimes: [...frame.sectorTimesCurrentSelf],
        frames: [...this.lapFrames],
        car: this.currentCar,
        track: this.currentTrack,
        layout: this.currentLayout,
        layoutLength: this.currentLayoutLength,
        valid: frame.currentLapValid,
      };
      this.lapFrames = [];
      this.emit('lapComplete', lapData);
    }
    this.lastCompletedLaps = frame.completedLaps;
  }

  // --- Mock mode ---

  private mockLapDist = 0;
  private mockLapNumber = 0;
  private mockSector = 0;

  private startMock(): void {
    this.connected = true;
    this.emit('connected');
    console.log('[R3EReader] Mock mode active');
    this.pollMock();
  }

  private pollMock(): void {
    if (this.stopped) return;

    const trackLength = 4011; // Zolder GP length
    this.mockLapDist += 30; // ~30m per 16ms at ~175km/h

    // Lap boundary
    if (this.mockLapDist >= trackLength) {
      this.mockLapDist -= trackLength;
      this.mockLapNumber++;

      const lapData = {
        lapNumber: this.mockLapNumber,
        lapTime: 92.5 + Math.random() * 3,
        sectorTimes: [30.1, 31.2, 31.2],
        frames: this.generateMockFrames(trackLength),
        car: 'Porsche 911 GT3 R',
        track: 'Zolder',
        layout: 'GP',
        layoutLength: trackLength,
        valid: true,
      };
      this.emit('lapComplete', lapData);
    }

    // Sector boundary
    const newSector = this.mockLapDist < trackLength * 0.33 ? 0
      : this.mockLapDist < trackLength * 0.66 ? 1 : 2;
    if (newSector !== this.mockSector) {
      this.emit('sectorComplete', this.mockSector, 30 + Math.random() * 2);
      this.mockSector = newSector;
    }

    const frame = this.generateMockFrame(this.mockLapDist, trackLength);
    this.emit('frame', frame);

    this.pollTimer = setTimeout(() => this.pollMock(), POLL_INTERVAL_MS);
  }

  private generateMockFrame(dist: number, trackLength: number): R3EFrame {
    const fraction = dist / trackLength;
    // Simulate braking zones
    const isBraking = [0.08, 0.25, 0.45, 0.65, 0.82].some(
      (bz) => Math.abs(fraction - bz) < 0.02,
    );

    return {
      versionMajor: 2,
      versionMinor: 16,
      gamePaused: false,
      gameInMenus: false,
      gameInReplay: false,
      trackId: 1,
      layoutId: 1,
      trackName: 'Zolder',
      layoutName: 'GP',
      layoutLength: trackLength,
      sessionType: 1,
      sessionPhase: 5,
      completedLaps: this.mockLapNumber,
      currentLapValid: true,
      trackSector: this.mockSector,
      lapDistance: dist,
      lapDistanceFraction: fraction,
      lapTimeBestSelf: 92.5,
      sectorTimesBestSelf: [30.1, 31.2, 31.2],
      lapTimePreviousSelf: 93.0,
      lapTimeCurrentSelf: fraction * 93,
      sectorTimesCurrentSelf: [30.1, 31.2, 31.2],
      carModelId: 7011,
      carName: 'Porsche 911 GT3 R',
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
  }

  private generateMockFrames(trackLength: number): CompactFrame[] {
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
        bt: [520 + Math.random() * 80, 525 + Math.random() * 80, 420 + Math.random() * 60, 415 + Math.random() * 60],
        ts: Date.now(),
      });
    }
    return frames;
  }
}

// Standalone test
if (require.main === module) {
  const reader = new R3EReader();
  reader.on('connected', () => console.log('[R3EReader] Connected'));
  reader.on('disconnected', () => console.log('[R3EReader] Disconnected'));
  reader.on('frame', (f: R3EFrame) => {
    console.log(
      `[Frame] speed=${f.carSpeed.toFixed(1)}km/h gear=${f.gear} thr=${f.throttle.toFixed(2)} brk=${f.brake.toFixed(2)} dist=${f.lapDistance.toFixed(0)}m`,
    );
  });
  reader.on('lapComplete', (lap: unknown) => console.log('[LapComplete]', lap));
  reader.on('sectorComplete', (n: number, t: number) =>
    console.log(`[Sector ${n}] ${t.toFixed(3)}s`),
  );
  reader.start();
  console.log('[R3EReader] Started. Press Ctrl+C to stop.');
}
