/**
 * ACE Shared Memory — struct offsets and type definitions.
 *
 * Three pages:
 *   Local\ACEVOPhysics   — raw physics telemetry, ~5 KB, every sim step
 *   Local\ACEVOGraphic   — HUD + session state,  ~18 KB, every rendered frame
 *   Local\ACEVOStatic    — static session metadata, ~1 KB, written once
 *
 * API revision: 2026-03-31
 * Source: Steam Community Guide id=3707421508 (Rwaggy505Games)
 *
 * ⚠️  OFFSET NOTES
 *  - Physics offsets are computed from the documented field sequence with Pack=4
 *    (same convention as AC / ACC connectors in SecondMonitor).
 *  - Graphic offsets are calculated including all embedded sub-structs at their
 *    documented fixed sizes: SMEvoTyreState×4=1024B, SMEvoDamageState=128B,
 *    SMEvoPitInfo=64B, SMEvoInstrumentation×3=384B, SMEvoElectronics×4=512B,
 *    SMEvoSessionState=256B, SMEvoTimingState=256B.
 *  - Static offsets include alignment padding (Pack=4).
 *  - All offsets MUST be verified empirically on first connection by checking
 *    logged values against in-game display (speed, npos, car name, etc.).
 */

// ── Shared memory names ─────────────────────────────────────────────────────

// Names confirmed working (acevo_pmf_* variant used by ACE and community connectors).
// Local\ACEVO* names always return handle=0 — removed.
export const ACE_SHM_PHYSICS = "Local\\acevo_pmf_physics";
export const ACE_SHM_GRAPHIC = "Local\\acevo_pmf_graphics";
export const ACE_SHM_STATIC = "Local\\acevo_pmf_static";

// Read buffer sizes — must not exceed the actual SHM region size created by the
// game, otherwise koffi.decode will access violation. Values derived from the
// documented field sequences above; do NOT add a "generous margin" here.
export const ACE_PHYSICS_BUF = 800; // documented total: 800 bytes
export const ACE_GRAPHIC_BUF = 3940; // documented total: 3937 bytes, rounded to 4
export const ACE_STATIC_BUF = 256; // documented total: 208 bytes, rounded up

// ── ACEVO_STATUS enum ────────────────────────────────────────────────────────

export const AC_OFF = 0;
export const AC_REPLAY = 1;
export const AC_LIVE = 2;
export const AC_PAUSE = 3;

// ── ACEVO_CAR_LOCATION enum ──────────────────────────────────────────────────

export const ACEVO_PITLANE = 1;
export const ACEVO_PITENTRY = 2;
export const ACEVO_PITEXIT = 3;

// ── SPageFilePhysics offsets (Pack=4, same prefix as AC/ACC) ─────────────────
//
// Sequence (cumulative):
//  0  packetId       int32    4
//  4  gas            float    4
//  8  brake          float    4
// 12  fuel           float    4
// 16  gear           int32    4
// 20  rpms           int32    4
// 24  steerAngle     float    4
// 28  speedKmh       float    4
// 32  velocity[3]    float*3  12
// 44  accG[3]        float*3  12
// 56  wheelSlip[4]   float*4  16
// 72  wheelLoad[4]   float*4  16
// 88  wheelsPressure[4] float*4 16
//104  wheelAngularSpeed[4] float*4 16
//120  tyreWear[4]    float*4  16
//136  tyreDirtyLevel[4] float*4 16
//152  tyreCoreTemperature[4] float*4 16
//168  camberRAD[4]   float*4  16
//184  suspensionTravel[4] float*4 16
//200  drs            float    4
//204  tc             float    4  (intensity, not active flag)
//208  heading        float    4
//212  pitch          float    4
//216  roll           float    4
//220  cgHeight       float    4
//224  carDamage[5]   float*5  20
//244  numberOfTyresOut int32  4
//248  pitLimiterOn   int32    4
//252  abs            float    4  (intensity)
//256  kersCharge     float    4
//260  kersInput      float    4
//264  autoShifterOn  int32    4
//268  rideHeight[2]  float*2  8
//276  turboBoost     float    4
//280  ballast        float    4
//284  airDensity     float    4
//288  airTemp        float    4
//292  roadTemp       float    4
//296  localAngularVel[3] float*3 12
//308  finalFF        float    4
//312  performanceMeter float  4
//316  engineBrake    int32    4
//320  ersRecoveryLevel int32  4
//324  ersPowerLevel  int32    4
//328  ersHeatCharging int32   4
//332  ersIsCharging  int32    4
//336  kersCurrentKJ  float    4
//340  drsAvailable   int32    4
//344  drsEnabled     int32    4
//348  brakeTemp[4]   float*4  16  ← brake disc temps FL/FR/RL/RR
//364  clutch         float    4
//368  tyreTempI[4]   float*4  16
//384  tyreTempM[4]   float*4  16
//400  tyreTempO[4]   float*4  16
//416  isAIControlled int32    4
//420  tyreContactPoint[4][3] float*12 48
//468  tyreContactNormal[4][3] float*12 48
//516  tyreContactHeading[4][3] float*12 48
//564  brakeBias      float    4
//568  localVelocity[3] float*3 12
//580  P2PActivations int32    4
//584  P2PStatus      int32    4
//588  currentMaxRpm  int32    4
//592  mz[4]          float*4  16
//608  fx[4]          float*4  16
//624  fy[4]          float*4  16
//640  slipRatio[4]   float*4  16
//656  slipAngle[4]   float*4  16
//672  tcinAction     int32    4  ← TC active this frame (0=no,1=yes)
//676  absInAction    int32    4  ← ABS active this frame (0=no,1=yes)
//680  suspensionDamage[4] float*4 16
//696  tyreTemp[4]    float*4  16
//712  waterTemp      float    4
//716  brakeTorque[4] float*4  16
//732  frontBrakeCompound int32 4
//736  rearBrakeCompound  int32 4
//740  padLife[4]     float*4  16
//756  discLife[4]    float*4  16
//772  ignitionOn     int32    4
//776  starterEngineOn int32   4
//780  isEngineRunning int32   4
//784  kerbVibration  float    4
//788  slipVibrations float    4
//792  roadVibrations float    4
//796  absVibrations  float    4
// Total documented: 800 bytes

export const PHY = {
  packetId: 0,
  gas: 4,
  brake: 8,
  fuel: 12,
  gear: 16,
  rpms: 20, // int32 — engine RPM
  steerAngle: 24,
  speedKmh: 28,
  accG: 44, // float[3] — G-forces: [0]=lateral, [1]=vertical, [2]=longitudinal
  wheelsPressure: 88, // float[4] FL,FR,RL,RR — tyre pressures (PSI)
  wheelAngularSpeed: 104, // float[4] FL,FR,RL,RR — wheel angular speed (rad/s)
  suspensionTravel: 184, // float[4] FL,FR,RL,RR — suspension travel (m)
  rideHeight: 268, // float[2] front,rear — aero ride height (m)
  airTemp: 288, // float — ambient air temperature (°C)
  roadTemp: 292, // float — road surface temperature (°C)
  clutch: 364, // float — clutch position 0-1
  brakeTemp: 348, // float[4] FL,FR,RL,RR
  slipRatio: 640, // float[4] FL,FR,RL,RR — longitudinal tyre slip ratio
  slipAngle: 656, // float[4] FL,FR,RL,RR — tyre slip angle (rad)
  brakeTorque: 716, // float[4] FL,FR,RL,RR — brake torque (Nm)
  tcinAction: 672, // int32 — 1 when TC cutting power
  absInAction: 676, // int32 — 1 when ABS modulating brakes
} as const;

// ── SPageFileGraphicEvo offsets (Pack=4) ─────────────────────────────────────
//
// Calculation notes:
//  - All bool fields = 1 byte
//  - Enum fields (ACEVO_STATUS, etc.) = int32 = 4 bytes
//  - uint64_t with Pack=4 → aligned to 4 bytes
//  - short = 2 bytes; padding inserted before short after odd-byte sequences
//  - Sub-struct sizes used: TyreState=256, DamageState=128, PitInfo=64,
//    Instrumentation=128, Electronics=128, SessionState=256, TimingState=256
//
//   0  packetId                 int32   4
//   4  status                   int32   4   ← ACEVO_STATUS
//   8  focused_car_id_a         uint64  8
//  16  focused_car_id_b         uint64  8
//  24  player_car_id_a          uint64  8
//  32  player_car_id_b          uint64  8
//  40  rpm                      short   2
//  42  is_rpm_limiter_on        bool    1
//  43  is_change_up_rpm         bool    1
//  44  is_change_down_rpm       bool    1
//  45  tc_active                bool    1   ← TC intervening this frame
//  46  abs_active               bool    1   ← ABS intervening this frame
//  47  esc_active               bool    1
//  48  launch_active            bool    1
//  49  is_ignition_on           bool    1
//  50  is_engine_running        bool    1
//  51  kers_is_charging         bool    1
//  52  is_wrong_way             bool    1
//  53  is_drs_available         bool    1
//  54  battery_is_charging      bool    1
//  55  is_max_kj_per_lap_reached bool   1
//  56  is_max_charge_kj_per_lap_reached bool 1
//  57  [pad 1]
//  58  display_speed_kmh        short   2
//  60  display_speed_mph        short   2
//  62  display_speed_ms         short   2
//  64  pitspeeding_delta        float   4
//  68  gear_int                 short   2
//  70  [pad 2]
//  72  rpm_percent              float   4
//  76  gas_percent              float   4
//  80  brake_percent            float   4
//  84  handbrake_percent        float   4
//  88  clutch_percent           float   4
//  92  steering_percent         float   4
//  96  ffb_strength             float   4
// 100  car_ffb_mupliplier       float   4
// 104  water_temperature_percent float  4
// 108  water_pressure_bar       float   4
// 112  fuel_pressure_bar        float   4
// 116  water_temperature_c      int8    1
// 117  air_temperature_c        int8    1
// 118  [pad 2]
// 120  oil_temperature_c        float   4
// 124  oil_pressure_bar         float   4
// 128  exhaust_temperature_c    float   4
// 132  g_forces_x               float   4
// 136  g_forces_y               float   4
// 140  g_forces_z               float   4
// 144  turbo_boost              float   4
// 148  turbo_boost_level        float   4
// 152  turbo_boost_perc         float   4
// 156  steer_degrees            int32   4
// 160  current_km               float   4
// 164  total_km                 uint32  4
// 168  total_driving_time_s     uint32  4
// 172  time_of_day_hours        int32   4
// 176  time_of_day_minutes      int32   4
// 180  time_of_day_seconds      int32   4
// 184  delta_time_ms            int32   4
// 188  current_lap_time_ms      int32   4   ← current lap time in ms
// 192  predicted_lap_time_ms    int32   4
// 196  fuel_liter_current_quantity float 4
// 200  fuel_liter_current_quantity_percent float 4
// 204  fuel_liter_per_km        float   4
// 208  km_per_fuel_liter        float   4
// 212  current_torque           float   4
// 216  current_bhp              int32   4
// 220  tyre_lf  SMEvoTyreState          256
// 476  tyre_rf  SMEvoTyreState          256
// 732  tyre_lr  SMEvoTyreState          256
// 988  tyre_rr  SMEvoTyreState          256
//1244  npos                     float   4   ← normalised lap pos [0-1]
//1248  kers_charge_perc         float   4
//1252  kers_current_perc        float   4
//1256  control_lock_time        float   4
//1260  car_damage  SMEvoDamageState    128
//1388  car_location             int32   4
//1392  pit_info  SMEvoPitInfo           64
//1456  fuel_liter_used          float   4
//1460  fuel_liter_per_lap       float   4
//1464  laps_possible_with_fuel  float   4
//1468  battery_temperature      float   4
//1472  battery_voltage          float   4
//1476  instantaneous_fuel_liter_per_km float 4
//1480  instantaneous_km_per_fuel_liter float 4
//1484  gear_rpm_window          float   4
//1488  instrumentation      SMEvoInstrumentation  128
//1616  instrumentation_min_limit               128
//1744  instrumentation_max_limit               128
//1872  electronics          SMEvoElectronics      128
//2000  electronics_min_limit                   128
//2128  electronics_max_limit                   128
//2256  electronics_is_modifiable               128
//2384  total_lap_count          int32   4   ← total laps completed this session
//2388  current_pos              uint32  4
//2392  total_drivers            uint32  4
//2396  last_laptime_ms          int32   4   ← last completed lap time [ms]
//2400  best_laptime_ms          int32   4
//2404  flag                     int32   4
//2408  global_flag              int32   4
//2412  max_gears                uint32  4
//2416  engine_type              int32   4
//2420  has_kers                 bool    1
//2421  is_last_lap              bool    1
//2422  performance_mode_name    char[33] 33
//2455  [pad 1]
//2456  diff_coast_raw_value     float   4
//2460  diff_power_raw_value     float   4
//2464  race_cut_gained_time_ms  int32   4
//2468  distance_to_deadline     int32   4
//2472  race_cut_current_delta   float   4
//2476  session_state  SMEvoSessionState  256
//2732  timing_state   SMEvoTimingState   256
//2988  player_ping              int32   4
//2992  player_latency           int32   4
//2996  player_cpu_usage         int32   4
//3000  player_cpu_usage_avg     int32   4
//3004  player_qos               int32   4
//3008  player_qos_avg           int32   4
//3012  player_fps               int32   4
//3016  player_fps_avg           int32   4
//3020  driver_name              char[33] 33
//3053  driver_surname           char[33] 33
//3086  car_model                char[33] 33  ← car identifier / display name
//3119  is_in_pit_box            bool    1
//3120  is_in_pit_lane           bool    1   ← in any part of pit lane
//3121  is_valid_lap             bool    1   ← lap is timing-valid
//3122  [pad 2]
//3124  car_coordinates[60][3]   float   720
//3844  gap_ahead                float   4
//3848  gap_behind               float   4
//3852  active_cars              uint8   1
//3853  [pad 3]
//3856  fuel_per_lap             float   4
//3860  fuel_estimated_laps      float   4
//3864  assists_state  SMEvoAssistsState  64
//3928  max_fuel                 float   4
//3932  max_turbo_boost          float   4
//3936  use_single_compound      bool    1

export const GFX = {
  packetId: 0,
  status: 4, // int32 — ACEVO_STATUS
  tcActive: 45, // bool (uint8)
  absActive: 46, // bool (uint8)
  currentLapTimeMs: 188, // int32
  npos: 1244, // float — normalised lap position [0.0-1.0]
  totalLapCount: 2384, // int32 — laps completed this session
  lastLaptimeMs: 2396, // int32 — last completed lap [ms]
  carModel: 3086, // char[33]
  isInPitLane: 3120, // bool (uint8)
  isValidLap: 3121, // bool (uint8)
  carCoordinates: 3124, // float[60][3] — player at index 0 in singleplayer
} as const;

// ── SPageFileStaticEvo offsets (Pack=4) ──────────────────────────────────────
//
//  0  sm_version               char[15]  15
// 15  ac_evo_version           char[15]  15
// 30  [pad 2]
// 32  session                  int32      4   ACEVO_SESSION_TYPE
// 36  session_name             char[33]  33
// 69  event_id                 uint8      1
// 70  session_id               uint8      1
// 71  [pad 1]
// 72  starting_grip            int32      4   ACEVO_STARTING_GRIP
// 76  starting_ambient_temperature_c float 4
// 80  starting_ground_temperature_c  float 4
// 84  is_static_weather        bool       1
// 85  is_timed_race            bool       1
// 86  is_online                bool       1
// 87  [pad 1]
// 88  number_of_sessions       int32      4
// 92  nation                   char[33]  33
//125  [pad 3]
//128  longitude                float      4
//132  latitude                 float      4
//136  track                    char[33]  33  ← track identifier
//169  track_configuration      char[33]  33  ← layout/configuration name
//202  [pad 2]
//204  track_length_m           float      4  ← track length [metres]

export const STA = {
  smVersion: 0, // char[15]
  acEvoVersion: 15, // char[15]
  track: 136, // char[33]
  trackConfiguration: 169, // char[33]
  trackLengthM: 204, // float
} as const;

// ── Helper readers ───────────────────────────────────────────────────────────

export const readInt32 = (buf: Buffer, offset: number): number =>
  buf.readInt32LE(offset);

export const readUint32 = (buf: Buffer, offset: number): number =>
  buf.readUInt32LE(offset);

export const readFloat = (buf: Buffer, offset: number): number =>
  buf.readFloatLE(offset);

export const readUint8 = (buf: Buffer, offset: number): number =>
  buf.readUInt8(offset);

/** Read a null-terminated ASCII string from a fixed-size char[n] field. */
export const readString = (
  buf: Buffer,
  offset: number,
  maxLen: number,
): string => {
  const end = buf.indexOf(0, offset);
  const actualEnd = end === -1 || end > offset + maxLen ? offset + maxLen : end;
  return buf.toString("ascii", offset, actualEnd).replace(/\0/g, "").trim();
};

/** Read float[count] array, returns number[]. */
export const readFloatArray = (
  buf: Buffer,
  offset: number,
  count: number,
): number[] => {
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(buf.readFloatLE(offset + i * 4));
  }
  return result;
};
