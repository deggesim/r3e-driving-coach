# ACE `.carsetup` Format Specification
> Reverse-engineered from Assetto Corsa EVO v0.6  
> Format: **Protocol Buffers (binary, little-endian float32)**  
> File size: ~480–560 bytes depending on version  
> Derived by: cross-referencing binary fields with in-game UI screenshots

---

## Top-level structure

A `.carsetup` file is a flat protobuf message with the following top-level fields:

| Field tag | Wire type | Multiplicity | Content |
|-----------|-----------|--------------|---------|
| `f1`      | LEN (2)   | ×1           | General / header block |
| `f2`      | LEN (2)   | ×4           | Per-wheel damper block (order: FL, FR, RL, RR) |
| `f3`      | LEN (2)   | ×4           | Per-wheel ARB physical block (order: FL, FR, RL, RR) |
| `f4`      | LEN (2)   | ×4           | Per-wheel geometry block (order: FL, FR, RL, RR) |
| `f5`      | LEN (2)   | ×1           | Electronics (TC / ABS) |
| `f6`      | LEN (2)   | ×1           | Aero + ride height |
| `f7`      | LEN (2)   | ×1           | Fuel |
| `f9`      | LEN (2)   | ×1 (v0.6+)   | Preset ID — ASCII string, no protobuf sub-fields |

> **Note:** `f8` not observed. `f9` is absent in pre-v0.6 files.

---

## Field `f1` — General / Header (len ≈ 44 bytes)

Sub-fields, all float32 (wire type 5) unless noted:

| Sub-field | Type    | UI parameter                    | Unit    | Notes |
|-----------|---------|----------------------------------|---------|-------|
| `f1.f1`   | varint  | Internal car ID                  | —       | 592 = Porsche 718 GT4 CS MR; 11096 = unknown (R.carsetup) |
| `f1.f2`   | float32 | **Rapporto Sterzo**              | click   | 13.0 observed |
| `f1.f3`   | LEN     | Brake sub-block (see below)      | —       | len=10 |
| `f1.f3.f1`| float32 | **Ripartizione Freno Anteriore** | %       | 70.0 = 70% front |
| `f1.f3.f2`| float32 | ? (max brake value)              | —       | Always 100.0 observed |
| `f1.f4`   | LEN     | Electronics + ARB sub-block      | —       | len=15 |
| `f1.f4.f1`| float32 | TC1 internal ratio               | —       | 0.40 → UI click 2; not directly the click value |
| `f1.f4.f2`| float32 | ABS internal ratio               | —       | 0.70 → UI click 8; not directly the click value |
| `f1.f4.f3`| float32 | **ARB Anteriore**                | click   | 5.0 = click 5 ✓ direct |

---

## Field `f2` — Dampers (×4, per wheel: FL, FR, RL, RR)

Each `f2` sub-message has len=39 bytes. Front and rear have the same structure but different values.

| Sub-field   | Type    | UI parameter                      | Unit    | Notes |
|-------------|---------|-----------------------------------|---------|-------|
| `f2.f1`     | float32 | **Rigidità delle Sospensioni**    | N/m     | 112000 (ant) / 130000 (post) |
| `f2.f2`     | LEN     | Bump sub-block                    | —       | len=10 |
| `f2.f2.f1`  | float32 | Bump Lento (internal ratio)       | —       | Negative values observed; maps to click via car-specific LUT |
| `f2.f2.f2`  | float32 | Bump Veloce (internal)            | —       | 600–800 range |
| `f2.f3`     | LEN     | Rebound sub-block                 | —       | len=10 |
| `f2.f3.f1`  | float32 | **Ammortizzatore Lento in Estensione** (internal) | — | 0.075–0.077 range |
| `f2.f3.f2`  | float32 | Rebound Veloce (internal)         | —       | 800 observed |
| `f2.f4`     | float32 | Fast damping (internal)           | —       | 10000 observed |
| `f2.f5`     | float32 | ? (damping ratio?)                | —       | 0.08 observed |

**Click → ratio mapping** (empirical, Porsche 718 GT4 CS MR):

| UI Click | `f2.f2.f1` (Bump Lento Ant) | `f2.f3.f1` (Reb Lento Ant) |
|----------|-----------------------------|----------------------------|
| 7        | -0.0220                     | —                          |
| 10       | —                           | 0.0770                     |
| 8        | -0.0080 (post)              | 0.0750 (post)              |

> ⚠️ The mapping between UI clicks and internal ratio values is **car-specific**. The ratio values are the actual physics parameters; clicks are just the UI index.

---

## Field `f3` — ARB physical parameters (×4, per wheel: FL, FR, RL, RR)

Each sub-message len=20 bytes. Contains 4 float32 values.

| Sub-field | Type    | Content                     | Notes |
|-----------|---------|-----------------------------|-------|
| `f3.f1`   | float32 | ARB stiffness (internal)    | 7.0 (ant) / 8.0 (post) in test file |
| `f3.f2`   | float32 | ? (always 1000.0 observed)  | Possibly ARB max or reference |
| `f3.f3`   | float32 | ARB stiffness secondary     | 10.0 (ant) / 8.0 (post) |
| `f3.f4`   | float32 | ? (always 1000.0 observed)  | |

> ⚠️ The **UI click values** for ARB (ant=5, post=3) do NOT directly match these internal values.  
> `f1.f4.f3` stores the ARB ant click directly. ARB post click location is **not yet confirmed**.  
> `f3` values appear to be derived physical parameters computed by the game engine.

---

## Field `f4` — Geometry (×4, per wheel: FL, FR, RL, RR)

Front wheels (FL, FR): len=30 bytes (6 sub-fields).  
Rear wheels (RL, RR): len=25 bytes (5 sub-fields, `f4.f4` absent on rear).

| Sub-field | Type    | UI parameter              | Unit  | Confirmed |
|-----------|---------|---------------------------|-------|-----------|
| `f4.f1`   | float32 | **Pressione Pneumatico**  | PSI   | 24.0 PSI ✓ |
| `f4.f2`   | float32 | **Campanatura**           | °     | -3.3° (ant), -3.2° (post) ✓ |
| `f4.f3`   | float32 | **Convergenza**           | °     | -0.05° (ant), 0.11° (post) ✓ |
| `f4.f4`   | float32 | **Angolo di Sterzata**    | °     | -0.059° (ant only) ✓ |
| `f4.f5`   | float32 | Caster / kingpin (computed) | °   | ~-4.97° — appears computed by sim, differs L vs R |
| `f4.f6`   | float32 | ? (very small value)      | —     | ±0.0002 to ±0.0004; possibly suspension geometry artifact |

---

## Field `f5` — Electronics (len=10 bytes)

| Sub-field | Type    | UI parameter | Unit  | Confirmed |
|-----------|---------|--------------|-------|-----------|
| `f5.f1`   | float32 | **TC1**      | click | 2.0 ✓ |
| `f5.f3`   | float32 | **ABS**      | click | 8.0 ✓ |

> Note: `f5.f2` present in pre-v0.6 files (value 1.0), **absent** in v0.6. Possibly removed or merged.

---

## Field `f6` — Aerodinamica + Ride Height (len=38 bytes)

| Sub-field | Type    | UI parameter                  | Unit  | Confirmed |
|-----------|---------|-------------------------------|-------|-----------|
| `f6.f1`   | LEN     | Internal sub-block (len=16)   | —     | Contains unknown binary data, not float |
| `f6.f2`   | float32 | **Altezza da Terra Anteriore**| mm    | 90.0 ✓ |
| `f6.f3`   | float32 | **Altezza da Terra Posteriore**| mm   | 95.0 ✓ |
| `f6.f4`   | float32 | **Mescola Gomme**             | enum  | 1.0 = Slick (S) |
| `f6.f5`   | float32 | **Angolo Ala Posteriore**     | click | 2.0 ✓ |

**Mescola enum values** (partially confirmed):
| Value | Mescola |
|-------|---------|
| 1.0   | Slick (S) |
| 2.0   | ? (possibly Hard or Medium) |

---

## Field `f7` — Carburante (len=5 bytes)

| Sub-field | Type    | UI parameter   | Unit  | Confirmed |
|-----------|---------|----------------|-------|-----------|
| `f7.f1`   | float32 | **Carburante** | litri | 40.0 ✓ |

---

## Field `f9` — Preset ID string (v0.6+, len=77 bytes)

Raw ASCII string, **not** a protobuf sub-message. Contains the car + preset identifier.

Example: `ks_porsche_718_cayman_gt4_cs_mr_preset_gt4csmr_mech_1_preset_gt4csmr_visual_1`

Format appears to be: `{car_id}_preset_{mech_preset_id}_preset_{visual_preset_id}`

---

## Protobuf tag encoding reference

Tags are encoded as `(field_number << 3) | wire_type`:

| Wire type | Meaning         | Size |
|-----------|-----------------|------|
| 0         | varint          | variable |
| 2         | LEN (length-delimited) | variable |
| 5         | 32-bit (float32) | 4 bytes |

Common tags in this file:
- `0x0a` = field 1, LEN → `f1` header block
- `0x12` = field 2, LEN → `f2` damper block (repeated ×4)
- `0x1a` = field 3, LEN → `f3` ARB block (repeated ×4)
- `0x22` = field 4, LEN → `f4` geometry block (repeated ×4)
- `0x2a` = field 5, LEN → `f5` electronics block
- `0x32` = field 6, LEN → `f6` aero block
- `0x3a` = field 7, LEN → `f7` fuel block
- `0x4a` = field 9, LEN → `f9` preset ID string (v0.6+)
- `0x0d` = field 1, float32 (inside sub-messages)
- `0x15` = field 2, float32
- `0x1d` = field 3, float32
- `0x25` = field 4, float32
- `0x2d` = field 5, float32
- `0x35` = field 6, float32

---

## Version differences

| Feature | Pre-v0.6 | v0.6 |
|---------|----------|------|
| File size | ~480 bytes | ~554 bytes |
| `f9` preset string | ❌ absent | ✅ present (+77 bytes) |
| `f5.f2` field | ✅ present (1.0) | ❌ absent |
| `f5.f3` (ABS) | 3.0 | 8.0 (different car/setup) |
| `f1.f1` varint | 11096 | 592 |

---

## Known unknowns

| Unknown | Location | Notes |
|---------|----------|-------|
| ARB Posteriore click value | Not confirmed | UI=3, but not found as direct click in any field; may be a click index into `f3[RL].f1` |
| `f1.f4.f1` / `f1.f4.f2` | TC/ABS ratio mapping | Internal ratio, not the click value; click→ratio is car-specific |
| `f6.f1` sub-block | 16 bytes, unknown structure | Possibly compound aero data or suspension geometry reference |
| `f3.f2` / `f3.f4` | Always 1000.0 | Possibly ARB range limits |
| `f2.f4` (fast damping) | 10000 | Unit unclear; may be N·s/m |
| `f2.f5` | 0.08 | Unknown |
| `f4.f6` | ±0.0002~0.0004 | Likely computed by sim |

---

## Suggested decoder interface (Python pseudocode)

```python
@dataclass
class WheelDamper:
    spring_rate: float      # N/m (f2.f1)
    bump_slow: float        # internal ratio (f2.f2.f1)
    bump_fast: float        # internal (f2.f2.f2)
    rebound_slow: float     # internal ratio (f2.f3.f1)
    rebound_fast: float     # internal (f2.f3.f2)

@dataclass
class WheelGeometry:
    tyre_pressure: float    # PSI (f4.f1)
    camber: float           # degrees (f4.f2)
    toe: float              # degrees (f4.f3)
    steer_angle: float      # degrees, front only (f4.f4)

@dataclass
class CarSetup:
    # Identification
    car_id: int             # f1.f1 varint
    preset_string: str      # f9 ASCII (v0.6+)
    
    # General
    steering_ratio: float   # f1.f2
    brake_bias_front: float # f1.f3.f1 (%)
    arb_front: float        # f1.f4.f3 (click)
    
    # Electronics
    tc1: float              # f5.f1 (click)
    abs: float              # f5.f3 (click)
    
    # Dampers (FL, FR, RL, RR)
    dampers: list[WheelDamper]   # len=4
    
    # Geometry (FL, FR, RL, RR)
    geometry: list[WheelGeometry] # len=4
    
    # Aero / Chassis
    ride_height_front: float  # mm (f6.f2)
    ride_height_rear: float   # mm (f6.f3)
    wing_rear: float          # click (f6.f5)
    tyre_compound: float      # enum: 1=Slick(S) (f6.f4)
    
    # Fuel
    fuel: float               # litres (f7.f1)
```

---

## Sample file offsets (test.carsetup, v0.6)

For debugging / validation:

| Offset (hex) | Value (float32) | Parameter |
|---|---|---|
| 0x00d | 13.0 | Rapporto Sterzo |
| 0x014 | 70.0 | Ripartizione Freno Ant % |
| 0x02a | 5.0  | ARB Ant click |
| 0x033 | 112000.0 | Spring FL |
| 0x0d1 | 130000.0 | Spring RL |
| 0x12d | 24.0 | Pressure FL (PSI) |
| 0x14d | 24.0 | Pressure FR (PSI) |
| 0x16d | 24.0 | Pressure RL (PSI) |
| 0x188 | 24.0 | Pressure RR (PSI) |
| 0x1a3 | 2.0  | TC1 click |
| 0x1a8 | 8.0  | ABS click |
| 0x1c1 | 90.0 | Ride Height Ant (mm) |
| 0x1c6 | 95.0 | Ride Height Post (mm) |
| 0x1d0 | 2.0  | Wing Posteriore click |
| 0x1d7 | 40.0 | Carburante (L) |
| 0x1db | ASCII string | Preset ID (f9, 77 bytes) |
