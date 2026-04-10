/**
 * R3E Shared Memory Struct Definition
 * Source: sector3studios/r3e-api v3.x (sample-csharp/src/R3E.cs)
 * Shared memory name: $R3E
 *
 * All fields declared in struct order — offsets computed automatically.
 */

type FieldType = 'int32' | 'uint32' | 'float' | 'double' | 'byte';

type StructField = {
  name: string;
  type: FieldType;
  count?: number;
};

const SIZE: Record<FieldType, number> = {
  int32: 4,
  uint32: 4,
  float: 4,
  double: 8,
  byte: 1,
};

const STRUCT_FIELDS: StructField[] = [
  // Version
  { name: 'VersionMajor', type: 'int32' },
  { name: 'VersionMinor', type: 'int32' },

  // Game State
  { name: 'GamePaused', type: 'int32' },
  { name: 'GameInMenus', type: 'int32' },
  { name: 'GameInReplay', type: 'int32' },
  { name: 'GameUsingVr', type: 'int32' },
  { name: 'GameUnused1', type: 'int32' },
  { name: 'GameSimulationTime', type: 'float' },
  { name: 'GameSimulationTicks', type: 'float' },

  // PlayerData (inlined)
  { name: 'Player_SimTime', type: 'double' },
  { name: 'Player_SimTicks', type: 'double' },
  { name: 'Player_Pos_X', type: 'double' },
  { name: 'Player_Pos_Y', type: 'double' },
  { name: 'Player_Pos_Z', type: 'double' },
  { name: 'Player_Vel_X', type: 'double' },
  { name: 'Player_Vel_Y', type: 'double' },
  { name: 'Player_Vel_Z', type: 'double' },
  { name: 'Player_LocalVel_X', type: 'double' },
  { name: 'Player_LocalVel_Y', type: 'double' },
  { name: 'Player_LocalVel_Z', type: 'double' },
  { name: 'Player_Acc_X', type: 'double' },
  { name: 'Player_Acc_Y', type: 'double' },
  { name: 'Player_Acc_Z', type: 'double' },
  { name: 'Player_LocalAcc_X', type: 'double' },
  { name: 'Player_LocalAcc_Y', type: 'double' },
  { name: 'Player_LocalAcc_Z', type: 'double' },
  { name: 'Player_Gforce_X', type: 'double' },
  { name: 'Player_Gforce_Y', type: 'double' },
  { name: 'Player_Gforce_Z', type: 'double' },
  { name: 'Player_Orientation_X', type: 'double' },
  { name: 'Player_Orientation_Y', type: 'double' },
  { name: 'Player_Orientation_Z', type: 'double' },
  { name: 'Player_AngVel_X', type: 'double' },
  { name: 'Player_AngVel_Y', type: 'double' },
  { name: 'Player_AngVel_Z', type: 'double' },
  { name: 'Player_AngAcc_X', type: 'double' },
  { name: 'Player_AngAcc_Y', type: 'double' },
  { name: 'Player_AngAcc_Z', type: 'double' },

  // Session Info
  { name: 'TrackName', type: 'byte', count: 64 },
  { name: 'LayoutName', type: 'byte', count: 64 },
  { name: 'TrackId', type: 'int32' },
  { name: 'LayoutId', type: 'int32' },
  { name: 'LayoutLength', type: 'float' },
  { name: 'SectorStartFactors', type: 'float', count: 3 },
  { name: 'RaceSessionLaps', type: 'int32', count: 3 },
  { name: 'RaceSessionMinutes', type: 'int32', count: 3 },
  { name: 'EventIndex', type: 'int32' },
  { name: 'SessionType', type: 'int32' },
  { name: 'SessionIteration', type: 'int32' },
  { name: 'SessionLengthFormat', type: 'int32' },
  { name: 'SessionPitSpeedLimit', type: 'float' },
  { name: 'SessionPhase', type: 'int32' },
  { name: 'SessionLap', type: 'int32' },
  { name: 'SessionNumLaps', type: 'int32' },
  { name: 'SessionTimeRemaining', type: 'float' },
  { name: 'SessionTimeDuration', type: 'float' },
  { name: 'Position', type: 'int32' },
  { name: 'PositionClass', type: 'int32' },
  { name: 'FinishStatus', type: 'int32' },
  { name: 'CutTrackWarnings', type: 'int32' },

  // Pit/Flag state
  { name: 'PitWindowStatus', type: 'int32' },
  { name: 'PitWindowStart', type: 'int32' },
  { name: 'PitWindowEnd', type: 'int32' },
  { name: 'InPitlane', type: 'int32' },
  { name: 'PitMenuSelection', type: 'int32' },
  { name: 'PitState', type: 'int32' },
  { name: 'PitTotalDuration', type: 'float' },
  { name: 'PitElapsedTime', type: 'float' },
  { name: 'PitAction', type: 'int32' },
  { name: 'NumPitstopsPerformed', type: 'int32' },
  { name: 'Flags_Yellow', type: 'int32' },
  { name: 'Flags_YellowCausedIt', type: 'int32' },
  { name: 'Flags_YellowOvertake', type: 'int32' },
  { name: 'Flags_YellowPositions', type: 'int32' },
  { name: 'Flags_Blue', type: 'int32' },
  { name: 'Flags_Black', type: 'int32' },
  { name: 'Flags_BlackWhite', type: 'int32' },
  { name: 'Flags_Checkered', type: 'int32' },
  { name: 'Flags_Green', type: 'int32' },
  { name: 'Flags_PitstopRequest', type: 'int32' },

  // Lap data
  { name: 'CompletedLaps', type: 'int32' },
  { name: 'CurrentLapValid', type: 'int32' },
  { name: 'TrackSector', type: 'int32' },
  { name: 'LapDistance', type: 'float' },
  { name: 'LapDistanceFraction', type: 'float' },

  // Timing
  { name: 'LapTimeBestLeader', type: 'float' },
  { name: 'LapTimeBestLeaderClass', type: 'float' },
  { name: 'SectorTimesSessionBestLeader', type: 'float', count: 3 },
  { name: 'SectorTimesSessionBestLeaderClass', type: 'float', count: 3 },
  { name: 'LapTimeBestSelf', type: 'float' },
  { name: 'SectorTimesBestSelf', type: 'float', count: 3 },
  { name: 'LapTimePreviousSelf', type: 'float' },
  { name: 'SectorTimesPreviousSelf', type: 'float', count: 3 },
  { name: 'LapTimeCurrentSelf', type: 'float' },
  { name: 'SectorTimesCurrentSelf', type: 'float', count: 3 },
  { name: 'LapTimeDeltaLeader', type: 'float' },
  { name: 'LapTimeDeltaLeaderClass', type: 'float' },
  { name: 'TimeDeltaFront', type: 'float' },
  { name: 'TimeDeltaBehind', type: 'float' },
  { name: 'TimeDeltaBestSelf', type: 'float' },

  // Vehicle
  { name: 'VehicleInfo_ModelId', type: 'int32' },
  { name: 'VehicleInfo_ClassId', type: 'int32' },
  { name: 'VehicleInfo_Name', type: 'byte', count: 64 },
  { name: 'VehicleInfo_CarNumber', type: 'byte', count: 16 },
  { name: 'VehicleInfo_ClassPerformanceIndex', type: 'int32' },
  { name: 'VehicleInfo_EngineType', type: 'int32' },
  { name: 'EngineRps', type: 'float' },
  { name: 'MaxEngineRps', type: 'float' },
  { name: 'UpshiftRps', type: 'float' },
  { name: 'CarSpeed', type: 'float' },
  { name: 'Gear', type: 'int32' },
  { name: 'NumGears', type: 'int32' },
  { name: 'CarCgLocation', type: 'float', count: 3 },

  // Inputs
  { name: 'Throttle', type: 'float' },
  { name: 'ThrottleRaw', type: 'float' },
  { name: 'Brake', type: 'float' },
  { name: 'BrakeRaw', type: 'float' },
  { name: 'Clutch', type: 'float' },
  { name: 'ClutchRaw', type: 'float' },
  { name: 'SteerInputRaw', type: 'float' },
  { name: 'SteerLockDeg', type: 'float' },
  { name: 'SteerWheelRangeDeg', type: 'float' },

  // Aid settings
  { name: 'AidSettings_Abs', type: 'int32' },
  { name: 'AidSettings_Tc', type: 'int32' },
  { name: 'AidSettings_Esp', type: 'int32' },
  { name: 'AidSettings_Countersteer', type: 'int32' },
  { name: 'AidSettings_CornferingForce', type: 'int32' },
  { name: 'AidAbsActive', type: 'float' },
  { name: 'AidTcActive', type: 'float' },
  { name: 'AidEspActive', type: 'float' },

  // Engine/fuel
  { name: 'FuelLeft', type: 'float' },
  { name: 'FuelCapacity', type: 'float' },
  { name: 'FuelPerLap', type: 'float' },
  { name: 'EngineTempCelsius', type: 'float' },
  { name: 'OilTempCelsius', type: 'float' },
  { name: 'EngineTorque', type: 'float' },
  { name: 'CurrentGearSpeed', type: 'float' },
  { name: 'EngineBrake', type: 'int32' },
  { name: 'EngineBrakeSetting', type: 'int32' },

  // Aero
  { name: 'TurboPressure', type: 'float' },
  { name: 'Drs', type: 'float' },
  { name: 'DrsAvailable', type: 'int32' },
  { name: 'DrsEnabled', type: 'int32' },
  { name: 'WheelLoad', type: 'float', count: 4 },
  { name: 'Downforce', type: 'float' },
  { name: 'Drag', type: 'float' },

  // Tires
  { name: 'TireGrip', type: 'float', count: 4 },
  { name: 'TireWear', type: 'float', count: 4 },
  { name: 'BrakeTempCurrentEstimate', type: 'float', count: 4 },
  { name: 'BrakeTempActualEstimate', type: 'float', count: 4 },
  { name: 'TireLoad', type: 'float', count: 4 },
  { name: 'TirePressure', type: 'float', count: 4 },
  { name: 'TireVelocity', type: 'float', count: 4 },
  { name: 'TireTempLeft', type: 'float', count: 4 },
  { name: 'TireTempCenter', type: 'float', count: 4 },
  { name: 'TireTempRight', type: 'float', count: 4 },
  { name: 'RideHeight', type: 'float', count: 4 },
  { name: 'SuspensionDeflection', type: 'float', count: 4 },
  { name: 'SuspensionVelocity', type: 'float', count: 4 },
  { name: 'Camber', type: 'float', count: 4 },
  { name: 'RollAngle', type: 'float', count: 2 },
  { name: 'WheelRps', type: 'float', count: 4 },
  { name: 'TireTypeFront', type: 'int32' },
  { name: 'TireTypeRear', type: 'int32' },
  { name: 'TireSubtypeFront', type: 'int32' },
  { name: 'TireSubtypeRear', type: 'int32' },

  // Damage
  { name: 'CarDamage_Engine', type: 'float' },
  { name: 'CarDamage_Transmission', type: 'float' },
  { name: 'CarDamage_Aerodynamics', type: 'float' },
  { name: 'CarDamage_Suspension', type: 'float' },

  // Driver
  { name: 'DriverName', type: 'byte', count: 64 },
  { name: 'DriverCarNumber', type: 'byte', count: 16 },
  { name: 'DriverClassId', type: 'int32' },
  { name: 'NumCars', type: 'int32' },
];

// Auto-compute offsets
const OFFSETS: Record<string, number> = {};
let _cursor = 0;
for (const field of STRUCT_FIELDS) {
  const byteSize = SIZE[field.type] * (field.count ?? 1);
  OFFSETS[field.name] = _cursor;
  _cursor += byteSize;
}

const STRUCT_SIZE_KNOWN = _cursor;

const readInt32 = (buf: Buffer, name: string): number =>
  buf.readInt32LE(OFFSETS[name]);

const readFloat = (buf: Buffer, name: string): number =>
  buf.readFloatLE(OFFSETS[name]);

const readDouble = (buf: Buffer, name: string): number =>
  buf.readDoubleLE(OFFSETS[name]);

const readFloatArray = (buf: Buffer, name: string, count: number): number[] => {
  const base = OFFSETS[name];
  return Array.from({ length: count }, (_, i) => buf.readFloatLE(base + i * 4));
};

const readString = (buf: Buffer, name: string, byteLen: number): string => {
  const base = OFFSETS[name];
  const slice = buf.subarray(base, base + byteLen);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? byteLen : end).toString('utf8');
};

export const SHM_NAME = '$R3E';
export const VERSION_MAJOR = 3;
export const VERSION_MINOR_MIN = 0;

export {
  OFFSETS,
  STRUCT_SIZE_KNOWN,
  STRUCT_FIELDS,
  readInt32,
  readFloat,
  readDouble,
  readFloatArray,
  readString,
};
