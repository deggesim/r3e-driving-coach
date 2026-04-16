/**
 * ACE Setup Reader — Decodes binary protobuf `.carsetup` files.
 *
 * Format: Protocol Buffers (binary, little-endian float32)
 * Source spec: ace_carsetup_spec.md (reverse-engineered from AC EVO v0.6)
 *
 * Top-level fields:
 *   f1  — General/Header (steering ratio, brake bias, ARB front, TC/ABS ratios)
 *   f2  — Dampers ×4 (FL, FR, RL, RR) — spring rates
 *   f3  — ARB physical ×4 (not used for UI display)
 *   f4  — Geometry ×4 (tyre pressure, camber, toe)
 *   f5  — Electronics (TC1 click, ABS click)
 *   f6  — Aero + ride height (ride height front/rear, tyre compound, rear wing)
 *   f7  — Fuel
 *   f9  — Preset ID ASCII string (v0.6+)
 */

import type { SetupData, SetupParam } from '../../shared/types';

// ── Minimal protobuf decoder ──────────────────────────────────────────────────

const WIRE_VARINT = 0;
const WIRE_FLOAT  = 5;
const WIRE_LEN    = 2;

/** Decode a varint from buf starting at pos. Returns [value, newPos]. */
const readVarint = (buf: Buffer, pos: number): [number, number] => {
  let result = 0;
  let shift  = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    shift  += 7;
    if ((byte & 0x80) === 0) break;
  }
  return [result >>> 0, pos]; // unsigned 32-bit
};

/** Read a float32 LE at pos, returns [value, pos+4]. */
const readProtoFloat = (buf: Buffer, pos: number): [number, number] => {
  if (pos + 4 > buf.length) return [0, pos + 4];
  return [buf.readFloatLE(pos), pos + 4];
};

/** Read a length-delimited field (LEN), returns [subBuf, newPos]. */
const readLen = (buf: Buffer, pos: number): [Buffer, number] => {
  const [len, afterLen] = readVarint(buf, pos);
  const end = afterLen + len;
  return [buf.subarray(afterLen, Math.min(end, buf.length)), end];
};

type ProtoField = {
  fieldNum: number;
  wireType: number;
  // Only one of these is set depending on wireType
  varintVal?: number;
  floatVal?:  number;
  lenVal?:    Buffer;
  pos:        number; // byte offset where this field started in parent buf
};

/**
 * Parse all fields from a protobuf message buffer.
 * Returns array of fields in order of appearance.
 */
const parseFields = (buf: Buffer): ProtoField[] => {
  const fields: ProtoField[] = [];
  let pos = 0;

  while (pos < buf.length) {
    const startPos = pos;
    let tag: number;
    [tag, pos] = readVarint(buf, pos);
    if (tag === 0) break; // padding / end

    const fieldNum  = tag >>> 3;
    const wireType  = tag & 0x07;

    if (wireType === WIRE_VARINT) {
      let val: number;
      [val, pos] = readVarint(buf, pos);
      fields.push({ fieldNum, wireType, varintVal: val, pos: startPos });
    } else if (wireType === WIRE_FLOAT) {
      let val: number;
      [val, pos] = readProtoFloat(buf, pos);
      fields.push({ fieldNum, wireType, floatVal: val, pos: startPos });
    } else if (wireType === WIRE_LEN) {
      let sub: Buffer;
      [sub, pos] = readLen(buf, pos);
      fields.push({ fieldNum, wireType, lenVal: sub, pos: startPos });
    } else {
      // Unknown wire type — stop parsing to avoid corruption
      break;
    }
  }

  return fields;
};

/** Get all fields with a given field number. */
const getAll = (fields: ProtoField[], num: number): ProtoField[] =>
  fields.filter((f) => f.fieldNum === num);

/** Get the first field with a given field number, or undefined. */
const getFirst = (fields: ProtoField[], num: number): ProtoField | undefined =>
  fields.find((f) => f.fieldNum === num);

/** Get float32 value of first field with num, or undefined. */
const getFloat = (fields: ProtoField[], num: number): number | undefined =>
  getFirst(fields, num)?.floatVal;

/** Get varint value of first field with num, or undefined. */
const getVarint = (fields: ProtoField[], num: number): number | undefined =>
  getFirst(fields, num)?.varintVal;

// ── Mescola lookup ────────────────────────────────────────────────────────────

const mescolaName = (val: number): string => {
  switch (Math.round(val)) {
    case 1:  return 'Slick (S)';
    case 2:  return 'Hard / Medium';
    default: return String(val);
  }
};

// ── Main decoder ─────────────────────────────────────────────────────────────

export const decodeCarSetup = (buf: Buffer, carId: string): SetupData => {
  const params: SetupParam[] = [];
  const push = (category: string, parameter: string, value: string): void => {
    params.push({ category, parameter, value });
  };

  const topFields = parseFields(buf);

  // ── f1 — General / Header ──────────────────────────────────────────────────

  const f1Field = getFirst(topFields, 1);
  let carIdFromFile = carId; // fallback to path-based ID

  if (f1Field?.lenVal) {
    const f1 = parseFields(f1Field.lenVal);

    // f1.f1 — Internal car ID (varint)
    const carIdVal = getVarint(f1, 1);
    if (carIdVal !== undefined) {
      carIdFromFile = String(carIdVal);
    }

    // f1.f2 — Rapporto Sterzo (float)
    const steeringRatio = getFloat(f1, 2);
    if (steeringRatio !== undefined) {
      push('Sterzo', 'Rapporto Sterzo', steeringRatio.toFixed(1));
    }

    // f1.f3 — Brake sub-block (LEN)
    const f1f3 = getFirst(f1, 3);
    if (f1f3?.lenVal) {
      const brakeFields = parseFields(f1f3.lenVal);
      const brakeBias = getFloat(brakeFields, 1);
      if (brakeBias !== undefined) {
        push('Freni', 'Ripartizione Freno Anteriore %', brakeBias.toFixed(1));
      }
    }

    // f1.f4 — Electronics + ARB sub-block (LEN)
    const f1f4 = getFirst(f1, 4);
    if (f1f4?.lenVal) {
      const elecFields = parseFields(f1f4.lenVal);
      const arbFront = getFloat(elecFields, 3);
      if (arbFront !== undefined) {
        push('Sospensioni', 'ARB Anteriore (click)', arbFront.toFixed(0));
      }
    }
  }

  // ── f2 — Dampers (×4: FL, FR, RL, RR) ─────────────────────────────────────

  const wheelLabels = ['FL', 'FR', 'RL', 'RR'];
  const f2Fields = getAll(topFields, 2);
  f2Fields.forEach((field, i) => {
    if (!field.lenVal) return;
    const label = wheelLabels[i] ?? `W${i}`;
    const sub = parseFields(field.lenVal);
    const spring = getFloat(sub, 1);
    if (spring !== undefined) {
      push('Sospensioni', `Molla ${label} (N/m)`, spring.toFixed(0));
    }
  });

  // ── f4 — Geometry (×4: FL, FR, RL, RR) ────────────────────────────────────

  const f4Fields = getAll(topFields, 4);
  f4Fields.forEach((field, i) => {
    if (!field.lenVal) return;
    const label = wheelLabels[i] ?? `W${i}`;
    const geo = parseFields(field.lenVal);

    const pressure = getFloat(geo, 1);
    if (pressure !== undefined) {
      push('Pneumatici', `Pressione ${label} (PSI)`, pressure.toFixed(1));
    }
    const camber = getFloat(geo, 2);
    if (camber !== undefined) {
      push('Geometria', `Campanatura ${label} (°)`, camber.toFixed(2));
    }
    const toe = getFloat(geo, 3);
    if (toe !== undefined) {
      push('Geometria', `Convergenza ${label} (°)`, toe.toFixed(3));
    }
  });

  // ── f5 — Electronics ───────────────────────────────────────────────────────

  const f5Field = getFirst(topFields, 5);
  if (f5Field?.lenVal) {
    const elec = parseFields(f5Field.lenVal);
    const tc1 = getFloat(elec, 1);
    if (tc1 !== undefined) {
      push('Elettronica', 'TC1 (click)', tc1.toFixed(0));
    }
    const abs = getFloat(elec, 3);
    if (abs !== undefined) {
      push('Elettronica', 'ABS (click)', abs.toFixed(0));
    }
  }

  // ── f6 — Aero + Ride Height ────────────────────────────────────────────────

  const f6Field = getFirst(topFields, 6);
  if (f6Field?.lenVal) {
    const aero = parseFields(f6Field.lenVal);
    // f6.f1 is a LEN sub-block we skip (unknown structure)
    const rhFront = getFloat(aero, 2);
    if (rhFront !== undefined) {
      push('Assetto', 'Altezza da Terra Anteriore (mm)', rhFront.toFixed(1));
    }
    const rhRear = getFloat(aero, 3);
    if (rhRear !== undefined) {
      push('Assetto', 'Altezza da Terra Posteriore (mm)', rhRear.toFixed(1));
    }
    const compound = getFloat(aero, 4);
    if (compound !== undefined) {
      push('Pneumatici', 'Mescola', mescolaName(compound));
    }
    const wing = getFloat(aero, 5);
    if (wing !== undefined) {
      push('Aerodinamica', 'Ala Posteriore (click)', wing.toFixed(0));
    }
  }

  // ── f7 — Fuel ──────────────────────────────────────────────────────────────

  const f7Field = getFirst(topFields, 7);
  if (f7Field?.lenVal) {
    const fuel = parseFields(f7Field.lenVal);
    const fuelLitres = getFloat(fuel, 1);
    if (fuelLitres !== undefined) {
      push('Carburante', 'Carburante (litri)', fuelLitres.toFixed(1));
    }
  }

  // ── f9 — Preset ID (v0.6+, raw ASCII string) ──────────────────────────────

  const f9Field = getFirst(topFields, 9);
  let presetId = '';
  if (f9Field?.lenVal) {
    presetId = f9Field.lenVal.toString('ascii').replace(/\0/g, '').trim();
    if (presetId.length > 0) {
      push('Identificazione', 'Preset ID', presetId);
    }
  }

  const setupText = [
    '**Setup decodificato da file .carsetup**',
    '',
    params.length > 0
      ? `${params.length} parametri estratti.`
      : 'Nessun parametro riconosciuto nel file.',
    presetId ? `Preset: ${presetId}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    carVerified: true,
    carFound: carIdFromFile,
    setupText,
    params,
    screenshots: [],
  };
};

// ── IPC helper types (used by main.ts handlers) ───────────────────────────────

export type AceSetupFileInfo = {
  filename: string;
  filePath: string;
  modifiedAt: string;
};
