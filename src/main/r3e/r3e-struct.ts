/**
 * R3E Shared Memory Struct Definition
 * Source: SecondMonitor/Connectors/R3EConnector/R3E.cs (v3.x, Pack=1)
 * Shared memory name: $R3E
 *
 * All fields declared in struct order — offsets computed automatically.
 * Nested C# structs are inlined field-by-field to preserve byte layout.
 */

type FieldType = "int32" | "uint32" | "float" | "double" | "byte";

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
  // ── Version ──────────────────────────────────────────────────────────────
  { name: "VersionMajor", type: "int32" },
  { name: "VersionMinor", type: "int32" },
  { name: "AllDriversOffset", type: "int32" },
  { name: "DriverDataSize", type: "int32" },

  // ── Game State ───────────────────────────────────────────────────────────
  { name: "GameMode", type: "int32" },
  { name: "GamePaused", type: "int32" },
  { name: "GameInMenus", type: "int32" },
  { name: "GameInReplay", type: "int32" },
  { name: "GameUsingVr", type: "int32" },
  { name: "GameUnused1", type: "int32" },

  // ── PlayerData (inlined, Pack=1) ─────────────────────────────────────────
  // struct PlayerData { int UserId; int GameSimulationTicks; double GameSimulationTime; ... }
  { name: "Player_UserId", type: "int32" },
  { name: "Player_SimTicks", type: "int32" }, // int, not double
  { name: "Player_SimTime", type: "double" },
  // Vector3<double> Position
  { name: "Player_Pos_X", type: "double" },
  { name: "Player_Pos_Y", type: "double" },
  { name: "Player_Pos_Z", type: "double" },
  // Vector3<double> Velocity
  { name: "Player_Vel_X", type: "double" },
  { name: "Player_Vel_Y", type: "double" },
  { name: "Player_Vel_Z", type: "double" },
  // Vector3<double> LocalVelocity
  { name: "Player_LocalVel_X", type: "double" },
  { name: "Player_LocalVel_Y", type: "double" },
  { name: "Player_LocalVel_Z", type: "double" },
  // Vector3<double> Acceleration
  { name: "Player_Acc_X", type: "double" },
  { name: "Player_Acc_Y", type: "double" },
  { name: "Player_Acc_Z", type: "double" },
  // Vector3<double> LocalAcceleration
  { name: "Player_LocalAcc_X", type: "double" },
  { name: "Player_LocalAcc_Y", type: "double" },
  { name: "Player_LocalAcc_Z", type: "double" },
  // Vector3<double> Orientation
  { name: "Player_Orientation_X", type: "double" },
  { name: "Player_Orientation_Y", type: "double" },
  { name: "Player_Orientation_Z", type: "double" },
  // Vector3<double> Rotation
  { name: "Player_Rotation_X", type: "double" },
  { name: "Player_Rotation_Y", type: "double" },
  { name: "Player_Rotation_Z", type: "double" },
  // Vector3<double> AngularAcceleration
  { name: "Player_AngAcc_X", type: "double" },
  { name: "Player_AngAcc_Y", type: "double" },
  { name: "Player_AngAcc_Z", type: "double" },
  // Vector3<double> AngularVelocity
  { name: "Player_AngVel_X", type: "double" },
  { name: "Player_AngVel_Y", type: "double" },
  { name: "Player_AngVel_Z", type: "double" },
  // Vector3<double> LocalAngularVelocity
  { name: "Player_LocalAngVel_X", type: "double" },
  { name: "Player_LocalAngVel_Y", type: "double" },
  { name: "Player_LocalAngVel_Z", type: "double" },
  // Vector3<double> LocalGforce
  { name: "Player_LocalGforce_X", type: "double" },
  { name: "Player_LocalGforce_Y", type: "double" },
  { name: "Player_LocalGforce_Z", type: "double" },
  // Remaining PlayerData scalars (needed for correct offsets)
  { name: "Player_SteeringForce", type: "double" },
  { name: "Player_SteeringForcePercentage", type: "double" },
  { name: "Player_EngineTorque", type: "double" },
  { name: "Player_CurrentDownforce", type: "double" },
  { name: "Player_Voltage", type: "double" },
  { name: "Player_ErsLevel", type: "double" },
  { name: "Player_PowerMguH", type: "double" },
  { name: "Player_PowerMguK", type: "double" },
  { name: "Player_TorqueMguK", type: "double" },
  // TireData<double> (4 × double each)
  { name: "Player_SuspensionDeflection", type: "double", count: 4 },
  { name: "Player_SuspensionVelocity", type: "double", count: 4 },
  { name: "Player_Camber", type: "double", count: 4 },
  { name: "Player_RideHeight", type: "double", count: 4 },
  { name: "Player_FrontWingHeight", type: "double" },
  { name: "Player_FrontRollAngle", type: "double" },
  { name: "Player_RearRollAngle", type: "double" },
  { name: "Player_ThirdSpringSuspDeflFront", type: "double" },
  { name: "Player_ThirdSpringSuspVelFront", type: "double" },
  { name: "Player_ThirdSpringSuspDeflRear", type: "double" },
  { name: "Player_ThirdSpringSuspVelRear", type: "double" },
  { name: "Player_Unused1", type: "double" },
  { name: "Player_Unused2", type: "double" },
  { name: "Player_Unused3", type: "double" },
  // PlayerData total: 2×int + 1+11×3+9+4×4+3+4+3 doubles = 560 bytes

  // ── Event And Session ─────────────────────────────────────────────────────
  { name: "TrackName", type: "byte", count: 64 },
  { name: "LayoutName", type: "byte", count: 64 },
  { name: "TrackId", type: "int32" },
  { name: "LayoutId", type: "int32" },
  { name: "LayoutLength", type: "float" },
  { name: "SectorStartFactors", type: "float", count: 3 }, // SectorStarts<float>
  { name: "RaceSessionLaps", type: "int32", count: 3 }, // RaceDuration<int>
  { name: "RaceSessionMinutes", type: "int32", count: 3 }, // RaceDuration<int>
  { name: "EventIndex", type: "int32" },
  { name: "SessionType", type: "int32" },
  { name: "SessionIteration", type: "int32" },
  { name: "SessionLengthFormat", type: "int32" },
  { name: "SessionPitSpeedLimit", type: "float" },
  { name: "SessionPhase", type: "int32" },
  { name: "StartLights", type: "int32" },
  { name: "TireWearActive", type: "int32" },
  { name: "FuelUseActive", type: "int32" },
  { name: "NumberOfLaps", type: "int32" },
  { name: "SessionTimeDuration", type: "float" },
  { name: "SessionTimeRemaining", type: "float" },
  { name: "MaxIncidentPoints", type: "int32" },
  { name: "EventUnused1", type: "float" },
  { name: "EventUnused2", type: "float" },

  // ── Pit ───────────────────────────────────────────────────────────────────
  { name: "PitWindowStatus", type: "int32" },
  { name: "PitWindowStart", type: "int32" },
  { name: "PitWindowEnd", type: "int32" },
  { name: "InPitlane", type: "int32" },
  { name: "PitMenuSelection", type: "int32" },
  // struct PitMenuState (12 ints = 48 bytes)
  { name: "PitMenuState_Preset", type: "int32" },
  { name: "PitMenuState_Penalty", type: "int32" },
  { name: "PitMenuState_Driverchange", type: "int32" },
  { name: "PitMenuState_Fuel", type: "int32" },
  { name: "PitMenuState_FrontTires", type: "int32" },
  { name: "PitMenuState_RearTires", type: "int32" },
  { name: "PitMenuState_Body", type: "int32" },
  { name: "PitMenuState_FrontWing", type: "int32" },
  { name: "PitMenuState_RearWing", type: "int32" },
  { name: "PitMenuState_Suspension", type: "int32" },
  { name: "PitMenuState_RequestPit", type: "int32" },
  { name: "PitMenuState_CancelPitRequest", type: "int32" },
  { name: "PitState", type: "int32" },
  { name: "PitTotalDuration", type: "float" },
  { name: "PitElapsedTime", type: "float" },
  { name: "PitAction", type: "int32" },
  { name: "NumPitstopsPerformed", type: "int32" },
  { name: "PitMinDurationTotal", type: "float" },
  { name: "PitMinDurationLeft", type: "float" },

  // ── Flags (struct Flags, inlined) ─────────────────────────────────────────
  { name: "Flags_Yellow", type: "int32" },
  { name: "Flags_YellowCausedIt", type: "int32" },
  { name: "Flags_YellowOvertake", type: "int32" },
  { name: "Flags_YellowPositionsGained", type: "int32" },
  { name: "Flags_SectorYellow", type: "int32", count: 3 }, // Sectors<int>
  { name: "Flags_ClosestYellowDistanceIntoTrack", type: "float" },
  { name: "Flags_Blue", type: "int32" },
  { name: "Flags_Black", type: "int32" },
  { name: "Flags_Green", type: "int32" },
  { name: "Flags_Checkered", type: "int32" },
  { name: "Flags_White", type: "int32" },
  { name: "Flags_BlackAndWhite", type: "int32" },

  // ── Scoring & Timings ─────────────────────────────────────────────────────
  { name: "Position", type: "int32" },
  { name: "PositionClass", type: "int32" },
  { name: "FinishStatus", type: "int32" },
  { name: "CutTrackWarnings", type: "int32" },
  // struct CutTrackPenalties (5 floats)
  { name: "Penalties_DriveThrough", type: "float" },
  { name: "Penalties_StopAndGo", type: "float" },
  { name: "Penalties_PitStop", type: "float" },
  { name: "Penalties_TimeDeduction", type: "float" },
  { name: "Penalties_SlowDown", type: "float" },
  { name: "NumPenalties", type: "int32" },
  { name: "CompletedLaps", type: "int32" },
  { name: "CurrentLapValid", type: "int32" },
  { name: "TrackSector", type: "int32" },
  { name: "LapDistance", type: "float" },
  { name: "LapDistanceFraction", type: "float" },
  { name: "LapTimeBestLeader", type: "float" },
  { name: "LapTimeBestLeaderClass", type: "float" },
  { name: "SectorTimesSessionBestLap", type: "float", count: 3 }, // Sectors<float>
  { name: "LapTimeBestSelf", type: "float" },
  { name: "SectorTimesBestSelf", type: "float", count: 3 },
  { name: "LapTimePreviousSelf", type: "float" },
  { name: "SectorTimesPreviousSelf", type: "float", count: 3 },
  { name: "LapTimeCurrentSelf", type: "float" },
  { name: "SectorTimesCurrentSelf", type: "float", count: 3 },
  { name: "LapTimeDeltaLeader", type: "float" },
  { name: "LapTimeDeltaLeaderClass", type: "float" },
  { name: "TimeDeltaFront", type: "float" },
  { name: "TimeDeltaBehind", type: "float" },
  { name: "TimeDeltaBestSelf", type: "float" },
  { name: "BestIndividualSectorTimeSelf", type: "float", count: 3 },
  { name: "BestIndividualSectorTimeLeader", type: "float", count: 3 },
  { name: "BestIndividualSectorTimeLeaderClass", type: "float", count: 3 },
  { name: "IncidentPoints", type: "int32" },
  { name: "LapValidState", type: "int32" },
  { name: "PrevLapValid", type: "int32" },
  { name: "TimingUnused1", type: "float" },
  { name: "TimingUnused2", type: "float" },
  { name: "TimingUnused3", type: "float" },

  // ── VehicleInfo (struct R3EDriverInfo, 128 bytes) ─────────────────────────
  { name: "VehicleInfo_Name", type: "byte", count: 64 },
  { name: "VehicleInfo_CarNumber", type: "int32" },
  { name: "VehicleInfo_ClassId", type: "int32" },
  { name: "VehicleInfo_ModelId", type: "int32" },
  { name: "VehicleInfo_TeamId", type: "int32" },
  { name: "VehicleInfo_LiveryId", type: "int32" },
  { name: "VehicleInfo_ManufacturerId", type: "int32" },
  { name: "VehicleInfo_UserId", type: "int32" },
  { name: "VehicleInfo_SlotId", type: "int32" },
  { name: "VehicleInfo_ClassPerformanceIndex", type: "int32" },
  { name: "VehicleInfo_EngineType", type: "int32" },
  { name: "VehicleInfo_CarWidth", type: "float" },
  { name: "VehicleInfo_CarLength", type: "float" },
  { name: "VehicleInfo_Rating", type: "float" },
  { name: "VehicleInfo_Reputation", type: "float" },
  { name: "VehicleInfo_Unused1", type: "float" },
  { name: "VehicleInfo_Unused2", type: "float" },

  // PlayerName (UTF-8, 64 bytes)
  { name: "PlayerName", type: "byte", count: 64 },

  // ── Vehicle State ─────────────────────────────────────────────────────────
  { name: "ControlType", type: "int32" },
  { name: "CarSpeed", type: "float" }, // m/s
  { name: "EngineRps", type: "float" }, // rad/s
  { name: "MaxEngineRps", type: "float" },
  { name: "UpshiftRps", type: "float" },
  { name: "Gear", type: "int32" },
  { name: "NumGears", type: "int32" },
  { name: "CarCgLocation", type: "float", count: 3 }, // Vector3<float>
  { name: "CarOrientation", type: "float", count: 3 }, // Orientation<float> (Pitch,Yaw,Roll)
  { name: "LocalAcceleration", type: "float", count: 3 }, // Vector3<float>
  { name: "TotalMass", type: "float" },
  { name: "FuelLeft", type: "float" },
  { name: "FuelCapacity", type: "float" },
  { name: "FuelPerLap", type: "float" },
  { name: "VirtualEnergyLeft", type: "float" },
  { name: "VirtualEnergyCapacity", type: "float" },
  { name: "VirtualEnergyPerLap", type: "float" },
  { name: "EngineWaterTemp", type: "float" },
  { name: "EngineOilTemp", type: "float" },
  { name: "FuelPressure", type: "float" },
  { name: "EngineOilPressure", type: "float" },
  { name: "TurboPressure", type: "float" },
  { name: "Throttle", type: "float" },
  { name: "ThrottleRaw", type: "float" },
  { name: "Brake", type: "float" },
  { name: "BrakeRaw", type: "float" },
  { name: "Clutch", type: "float" },
  { name: "ClutchRaw", type: "float" },
  { name: "SteerInputRaw", type: "float" },
  { name: "SteerLockDegrees", type: "int32" }, // int, not float
  { name: "SteerWheelRangeDegrees", type: "int32" }, // int, not float
  // struct AidSettings (5 ints); value 5 = currently active
  { name: "AidSettings_Abs", type: "int32" },
  { name: "AidSettings_Tc", type: "int32" },
  { name: "AidSettings_Esp", type: "int32" },
  { name: "AidSettings_Countersteer", type: "int32" },
  { name: "AidSettings_Cornering", type: "int32" },
  // struct Drs (4 ints)
  { name: "Drs_Equipped", type: "int32" },
  { name: "Drs_Available", type: "int32" },
  { name: "Drs_NumActivationsLeft", type: "int32" },
  { name: "Drs_Engaged", type: "int32" },
  { name: "PitLimiter", type: "int32" },
  // struct PushToPass (3 ints + 2 floats)
  { name: "PtP_Available", type: "int32" },
  { name: "PtP_Engaged", type: "int32" },
  { name: "PtP_AmountLeft", type: "int32" },
  { name: "PtP_EngagedTimeLeft", type: "float" },
  { name: "PtP_WaitTimeLeft", type: "float" },
  { name: "BrakeBias", type: "float" },
  { name: "DrsNumActivationsTotal", type: "int32" },
  { name: "PtPNumActivationsTotal", type: "int32" },
  { name: "BatterySoC", type: "float" },
  { name: "WaterLeft", type: "float" },
  { name: "AbsSetting", type: "int32" },
  { name: "HeadLights", type: "int32" },
  { name: "VehicleUnused1", type: "float" },

  // ── Tires ─────────────────────────────────────────────────────────────────
  { name: "TireType", type: "int32" }, // deprecated
  { name: "TireRps", type: "float", count: 4 }, // TireData<float>
  { name: "TireSpeed", type: "float", count: 4 },
  { name: "TireGrip", type: "float", count: 4 },
  { name: "TireWear", type: "float", count: 4 },
  { name: "TireFlatspot", type: "int32", count: 4 },
  { name: "TirePressure", type: "float", count: 4 },
  { name: "TireDirt", type: "float", count: 4 },
  // TireData<TireTempInformation>: each TireTempInformation =
  //   TireTemperature<float>{Left,Center,Right} + OptimalTemp + ColdTemp + HotTemp = 6 floats
  // Layout: FL[6], FR[6], RL[6], RR[6] = 96 bytes
  { name: "TireTemp_FL_Left", type: "float" },
  { name: "TireTemp_FL_Center", type: "float" },
  { name: "TireTemp_FL_Right", type: "float" },
  { name: "TireTemp_FL_Optimal", type: "float" },
  { name: "TireTemp_FL_Cold", type: "float" },
  { name: "TireTemp_FL_Hot", type: "float" },
  { name: "TireTemp_FR_Left", type: "float" },
  { name: "TireTemp_FR_Center", type: "float" },
  { name: "TireTemp_FR_Right", type: "float" },
  { name: "TireTemp_FR_Optimal", type: "float" },
  { name: "TireTemp_FR_Cold", type: "float" },
  { name: "TireTemp_FR_Hot", type: "float" },
  { name: "TireTemp_RL_Left", type: "float" },
  { name: "TireTemp_RL_Center", type: "float" },
  { name: "TireTemp_RL_Right", type: "float" },
  { name: "TireTemp_RL_Optimal", type: "float" },
  { name: "TireTemp_RL_Cold", type: "float" },
  { name: "TireTemp_RL_Hot", type: "float" },
  { name: "TireTemp_RR_Left", type: "float" },
  { name: "TireTemp_RR_Center", type: "float" },
  { name: "TireTemp_RR_Right", type: "float" },
  { name: "TireTemp_RR_Optimal", type: "float" },
  { name: "TireTemp_RR_Cold", type: "float" },
  { name: "TireTemp_RR_Hot", type: "float" },
  { name: "TireTypeFront", type: "int32" },
  { name: "TireTypeRear", type: "int32" },
  { name: "TireSubtypeFront", type: "int32" },
  { name: "TireSubtypeRear", type: "int32" },
  // TireData<BrakeTempInformation>: each = CurrentTemp + OptimalTemp + ColdTemp + HotTemp = 4 floats
  // Layout: FL[4], FR[4], RL[4], RR[4] = 64 bytes
  { name: "BrakeTemp_FL_Current", type: "float" },
  { name: "BrakeTemp_FL_Optimal", type: "float" },
  { name: "BrakeTemp_FL_Cold", type: "float" },
  { name: "BrakeTemp_FL_Hot", type: "float" },
  { name: "BrakeTemp_FR_Current", type: "float" },
  { name: "BrakeTemp_FR_Optimal", type: "float" },
  { name: "BrakeTemp_FR_Cold", type: "float" },
  { name: "BrakeTemp_FR_Hot", type: "float" },
  { name: "BrakeTemp_RL_Current", type: "float" },
  { name: "BrakeTemp_RL_Optimal", type: "float" },
  { name: "BrakeTemp_RL_Cold", type: "float" },
  { name: "BrakeTemp_RL_Hot", type: "float" },
  { name: "BrakeTemp_RR_Current", type: "float" },
  { name: "BrakeTemp_RR_Optimal", type: "float" },
  { name: "BrakeTemp_RR_Cold", type: "float" },
  { name: "BrakeTemp_RR_Hot", type: "float" },
  { name: "BrakePressure", type: "float", count: 4 },
  { name: "TractionControlSetting", type: "int32" },
  { name: "EngineMapSetting", type: "int32" },
  { name: "EngineBrakeSetting", type: "int32" },
  { name: "TractionControlPercent", type: "float" },
  { name: "TireOnMtrl", type: "int32", count: 4 },
  { name: "TireLoad", type: "float", count: 4 },

  // ── Damage (struct CarDamage: 6 floats) ───────────────────────────────────
  { name: "CarDamage_Engine", type: "float" },
  { name: "CarDamage_Transmission", type: "float" },
  { name: "CarDamage_Aerodynamics", type: "float" },
  { name: "CarDamage_Suspension", type: "float" },
  { name: "CarDamage_Unused1", type: "float" },
  { name: "CarDamage_Unused2", type: "float" },

  // ── Driver Info ───────────────────────────────────────────────────────────
  { name: "NumCars", type: "int32" },
  // DriverData[128] not mapped — would require per-entry offset arithmetic
];

// Auto-compute offsets
const OFFSETS: Record<string, number> = {};
let _cursor = 0;
for (const field of STRUCT_FIELDS) {
  OFFSETS[field.name] = _cursor;
  _cursor += SIZE[field.type] * (field.count ?? 1);
}

const STRUCT_SIZE_KNOWN = _cursor; // ~2012 bytes through NumCars

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
  return slice.subarray(0, end < 0 ? byteLen : end).toString("utf8");
};

export const SHM_NAME = "$R3E";
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
