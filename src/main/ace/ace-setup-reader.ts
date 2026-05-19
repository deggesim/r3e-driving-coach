/**
 * ACE Setup Reader — Decodes binary protobuf `.carsetup` files.
 *
 * Format: Protocol Buffers (binary, little-endian float32)
 * Reference: decode_setup.py (Python reference decoder, reverse-engineered from AC EVO v0.6)
 *
 * Top-level structure:
 *   f1  — Globali: f1.f1=ARB ant+post raw bytes (2× float32), f1.f2=rapporto sterzo,
 *          f1.f3=freni (bias%, pressione max%), f1.f4=differenziale (coast/power/preload)
 *   f2  — Sospensione ×4 (FL, FR, RL, RR): f2.f1=molla N/m,
 *          f2.f2=bump-stop (escursione, rigidità N), f2.f3=corsa,
 *          f2.f4=molla_aux, f2.f5=molla_aux2
 *   f3  — Ammortizzatori ×4: f3.f1=lento compressione, f3.f2=veloce compressione,
 *          f3.f3=lento estensione, f3.f4=veloce estensione (Ns/m)
 *   f4  — Geometria ×4: f4.f1=pressione PSI, f4.f2=camber, f4.f3=toe,
 *          f4.f4=caster, f4.f5=camber effettivo, f4.f7=mescola (0=slick, 1=wet)
 *   f5  — Elettronica: TC1 (f5.f1), TC2 (f5.f2), ABS (f5.f3), telemetria giri (f5.f5)
 *   f6  — Aero + altezze: f6.f1=4 pressioni raw (incerte), f6.f2=altezza ant,
 *          f6.f3=altezza post, f6.f5=ala posteriore
 *   f7  — Carburante (f7.f1)
 *   f9  — Preset ID ASCII string (v0.6+)
 */

import type { SetupData, SetupParam } from '../../shared/types.js';

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
  varintVal?: number;
  floatVal?:  number;
  lenVal?:    Buffer;
  pos:        number;
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
    if (tag === 0) break;

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
    case 0:  return 'Slick';
    case 1:  return 'Wet';
    default: return String(val);
  }
};

// ── Main decoder ─────────────────────────────────────────────────────────────

export const decodeCarSetup = (buf: Buffer, carId: string): SetupData => {
  const params: SetupParam[] = [];

  /** Format a number removing non-significant trailing zeros. */
  const fmt = (val: number, decimals: number): string => {
    if (decimals === 0) return val.toFixed(0);
    return parseFloat(val.toFixed(decimals)).toString();
  };

  const push = (category: string, parameter: string, value: string, unit?: string): void => {
    params.push({ category, parameter, value: unit ? `${value} ${unit}` : value });
  };

  const topFields = parseFields(buf);

  // ── f1 — Globali ──────────────────────────────────────────────────────────
  // ARB Posteriore e Precarico differenziale vengono pushati DOPO i parametri
  // per ruota (f2) così SuspensionTab li mostra in sharedBottom.

  let deferredArbPost: string | undefined;
  let deferredPrecarico: string | undefined;
  let deferredCoast: string | undefined;
  let deferredPower: string | undefined;

  const f1Field = getFirst(topFields, 1);
  if (f1Field?.lenVal) {
    const f1 = parseFields(f1Field.lenVal);

    // f1.f1 — ARB anteriore (subito) + posteriore (differito)
    const f1f1 = getFirst(f1, 1);
    if (f1f1?.lenVal && f1f1.lenVal.length >= 8) {
      push('Sospensioni', 'Barra Stabilizzatrice Anteriore', fmt(f1f1.lenVal.readFloatLE(0), 0), 'N/m');
      deferredArbPost = fmt(f1f1.lenVal.readFloatLE(4), 0);
    }

    // f1.f3 — Freni sub-block (ordine: Pressione Max, poi Ripartizione)
    const f1f3 = getFirst(f1, 3);
    if (f1f3?.lenVal) {
      const brakeFields = parseFields(f1f3.lenVal);
      const brakePressMax = getFloat(brakeFields, 2);
      if (brakePressMax !== undefined) {
        push('Freni', 'Moltiplicatore Coppia Frenante', fmt(brakePressMax, 1), '%');
      }
      const brakeBias = getFloat(brakeFields, 1);
      if (brakeBias !== undefined) {
        push('Freni', 'Ripartizione Frenata Anteriore', fmt(brakeBias, 1), '%');
      }
    }

    // f1.f2 — Rapporto Sterzo (float)
    const steeringRatio = getFloat(f1, 2);
    if (steeringRatio !== undefined) {
      push('Sterzo', 'Rapporto Sterzo', fmt(steeringRatio, 1));
    }

    // f1.f4 — Differenziale sub-block (LEN)
    const f1f4 = getFirst(f1, 4);
    if (f1f4?.lenVal) {
      const diffFields = parseFields(f1f4.lenVal);
      const diffCoast = getFloat(diffFields, 1);
      if (diffCoast !== undefined) {
        deferredCoast = fmt(diffCoast, 2);
      }
      const diffPower = getFloat(diffFields, 2);
      if (diffPower !== undefined) {
        deferredPower = fmt(diffPower, 2);
      }
      const diffPreload = getFloat(diffFields, 3);
      if (diffPreload !== undefined) {
        deferredPrecarico = fmt(diffPreload, 1);
      }
    }
  }

  // ── f2 — Sospensione (×4: FL, FR, RL, RR) ────────────────────────────────

  const wheelLabels = ['FL', 'FR', 'RL', 'RR'];
  const f2Fields = getAll(topFields, 2);
  f2Fields.forEach((field, i) => {
    if (!field.lenVal) return;
    const label = wheelLabels[i] ?? `W${i}`;
    const sub = parseFields(field.lenVal);

    const spring = getFloat(sub, 1);
    if (spring !== undefined) {
      push('Sospensioni', `Rigidità Molla ${label}`, fmt(spring, 0), 'N/m');
    }

    // f2.f2 — Bump-stop
    const bumpStopBlock = getFirst(sub, 2);
    if (bumpStopBlock?.lenVal) {
      const bs = parseFields(bumpStopBlock.lenVal);
      const bsEscursione = getFloat(bs, 1);
      if (bsEscursione !== undefined) {
        push('Sospensioni', `Bump-Stop Escursione ${label}`, fmt(bsEscursione, 4));
      }
      const bsRigidita = getFloat(bs, 2);
      if (bsRigidita !== undefined) {
        push('Sospensioni', `Rigidità Bumpstop ${label}`, fmt(bsRigidita, 0), 'N');
      }
    }

    // f2.f3 — Corsa sospensione
    const corsaBlock = getFirst(sub, 3);
    if (corsaBlock?.lenVal) {
      const corsa = parseFields(corsaBlock.lenVal);
      const corsa2 = getFloat(corsa, 1);
      if (corsa2 !== undefined) {
        push('Sospensioni', `Corsa 2 ${label}`, fmt(corsa2, 4));
      }
      const corsaMain = getFloat(corsa, 2);
      if (corsaMain !== undefined) {
        push('Sospensioni', `Corsa ${label}`, fmt(corsaMain, 1), 'mm');
      }
    }

    const mollaAux = getFloat(sub, 4);
    if (mollaAux !== undefined) {
      push('Sospensioni', `Molla Aux ${label}`, fmt(mollaAux, 4));
    }
    const mollaAux2 = getFloat(sub, 5);
    if (mollaAux2 !== undefined) {
      push('Sospensioni', `Molla Aux2 ${label}`, fmt(mollaAux2, 4));
    }
  });

  // Parametri differiti: vanno in sharedBottom (dopo i parametri per ruota)
  if (deferredArbPost !== undefined) {
    push('Sospensioni', 'Barra Stabilizzatrice Posteriore', deferredArbPost, 'N/m');
  }
  if (deferredPrecarico !== undefined) {
    push('Sospensioni', 'Precarico Differenziale', deferredPrecarico, 'Nm');
  }
  if (deferredCoast !== undefined) {
    push('Sospensioni', 'Coast Locking (0–1)', deferredCoast);
  }
  if (deferredPower !== undefined) {
    push('Sospensioni', 'Power Locking (0–1)', deferredPower);
  }

  // ── f3 — Ammortizzatori (×4: FL, FR, RL, RR) ─────────────────────────────

  const f3Fields = getAll(topFields, 3);
  f3Fields.forEach((field, i) => {
    if (!field.lenVal) return;
    const label = wheelLabels[i] ?? `W${i}`;
    const damp = parseFields(field.lenVal);

    const bumpSlow = getFloat(damp, 1);
    if (bumpSlow !== undefined) {
      push('Ammortizzatori', `Lento Compressione ${label}`, fmt(bumpSlow, 0), 'Ns/m');
    }
    const rebSlow = getFloat(damp, 3);
    if (rebSlow !== undefined) {
      push('Ammortizzatori', `Lento Estensione ${label}`, fmt(rebSlow, 0), 'Ns/m');
    }
    const bumpFast = getFloat(damp, 2);
    if (bumpFast !== undefined) {
      push('Ammortizzatori', `Veloce Compressione ${label}`, fmt(bumpFast, 0), 'Ns/m');
    }
    const rebFast = getFloat(damp, 4);
    if (rebFast !== undefined) {
      push('Ammortizzatori', `Veloce Estensione ${label}`, fmt(rebFast, 0), 'Ns/m');
    }
  });

  // ── f4 — Geometria (×4: FL, FR, RL, RR) ──────────────────────────────────

  let mescolaVal: number | undefined;
  const f4Fields = getAll(topFields, 4);
  f4Fields.forEach((field, i) => {
    if (!field.lenVal) return;
    const label = wheelLabels[i] ?? `W${i}`;
    const geo = parseFields(field.lenVal);

    const pressure = getFloat(geo, 1);
    if (pressure !== undefined) {
      push('Pneumatici', `Pressione ${label}`, fmt(pressure, 1), 'PSI');
    }
    const toe = getFloat(geo, 3);
    if (toe !== undefined) {
      push('Geometria', `Convergenza ${label}`, fmt(toe, 3), '°');
    }
    const camber = getFloat(geo, 2);
    if (camber !== undefined) {
      push('Geometria', `Campanatura ${label}`, fmt(camber, 2), '°');
    }
    const caster = getFloat(geo, 4);
    if (caster !== undefined) {
      push('Geometria', `Caster ${label}`, fmt(caster, 4));
    }
    const camberEff = getFloat(geo, 5);
    if (camberEff !== undefined) {
      push('Geometria', `Campanatura Effettiva ${label}`, fmt(camberEff, 2), '°');
    }
    // f4.f7 — mescola: letto dalla prima ruota che lo contiene
    if (mescolaVal === undefined) {
      mescolaVal = getFloat(geo, 7) ?? getVarint(geo, 7);
    }
  });

  if (mescolaVal !== undefined) {
    push('Carburante', 'Mescola', mescolaName(mescolaVal));
  }

  // ── f5 — Elettronica ───────────────────────────────────────────────────────

  const f5Field = getFirst(topFields, 5);
  if (f5Field?.lenVal) {
    const elec = parseFields(f5Field.lenVal);
    const tc1 = getFloat(elec, 1);
    if (tc1 !== undefined) {
      push('Elettronica', 'TC1', fmt(tc1, 0), 'click');
    }
    const tc2 = getFloat(elec, 2);
    if (tc2 !== undefined) {
      push('Elettronica', 'TC2', fmt(tc2, 0), 'click');
    }
    const abs = getFloat(elec, 3);
    if (abs !== undefined) {
      push('Elettronica', 'ABS', fmt(abs, 0), 'click');
    }
    const telemetry = getFloat(elec, 5);
    if (telemetry !== undefined) {
      push('Elettronica', 'Registrazione Telemetria', fmt(telemetry, 0), 'giri');
    }
  }

  // ── f6 — Aero + Altezze ────────────────────────────────────────────────────

  const f6Field = getFirst(topFields, 6);
  if (f6Field?.lenVal) {
    const aero = parseFields(f6Field.lenVal);

    // f6.f1 — pressioni raw (4× float32, campo incerto)
    const f6f1 = getFirst(aero, 1);
    if (f6f1?.lenVal && f6f1.lenVal.length === 16) {
      wheelLabels.forEach((wLabel, j) => {
        const press = f6f1.lenVal!.readFloatLE(j * 4);
        push('Pneumatici', `Pressione Set ${wLabel} (incerta)`, fmt(press, 1), 'PSI');
      });
    }

    const rhFront = getFloat(aero, 2);
    if (rhFront !== undefined) {
      push('Assetto', 'Altezza da Terra Anteriore', fmt(rhFront, 1), 'mm');
    }
    const rhRear = getFloat(aero, 3);
    if (rhRear !== undefined) {
      push('Assetto', 'Altezza da Terra Posteriore', fmt(rhRear, 1), 'mm');
    }
    const wing = getFloat(aero, 5);
    if (wing !== undefined) {
      push('Aerodinamica', 'Ala Posteriore', fmt(wing, 0), 'click');
    }
  }

  // ── f7 — Carburante ────────────────────────────────────────────────────────

  const f7Field = getFirst(topFields, 7);
  if (f7Field?.lenVal) {
    const fuel = parseFields(f7Field.lenVal);
    const fuelLitres = getFloat(fuel, 1);
    if (fuelLitres !== undefined) {
      push('Carburante', 'Carburante', fmt(fuelLitres, 1), 'L');
    }
  }

  // ── f9 — Preset ID (v0.6+, raw ASCII string) ──────────────────────────────

  const f9Field = getFirst(topFields, 9);
  let presetId = '';
  if (f9Field?.lenVal) {
    presetId = f9Field.lenVal.toString('ascii').replace(/\0/g, '').trim();
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
    carFound: carId,
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
