import type {
  SessionRow,
  LapRow,
  SessionDetail,
  SessionAnalysisRow,
} from "../../shared/types";

const ANALYSIS_R3E: SessionAnalysisRow = {
  id: -1,
  session_id: -1,
  version: 1,
  template_v3: `## [1] Dati sessione
**Simulatore:** RaceRoom Racing Experience · **Auto:** BMW M4 GT3 (GT3)
**Circuito:** Nürburgring - Grand Prix · **Giri analizzati:** 2 (giro 2-3)
**Miglior giro:** 1:55.234 (giro 2) · **Δ giri:** +0.546s

---

## [2] Setup
*Nessun setup caricato.*

---

## [3] Analisi tecnica per zona

| Zona | Km | Curva | Problema | Δ |
|---|---|---|---|---|
| Z-08 | 0.38 km | Einfahrt Mercedes | LATE_BRAKE | -0.12s |
| Z-15 | 0.73 km | Rettifilo est | SLOW_THROTTLE | -0.08s |
| Z-22 | 1.08 km | Ford Kurve | TRAIL_BRAKING | -0.05s |

**Dettaglio:**
- **Z-08 Einfahrt Mercedes** — freno 18m più tardi della baseline, velocità di apice 3 km/h inferiore (82 vs 85 km/h). Prova ad anticipare di 10m il punto di staccata.
- **Z-15 Rettifilo est** — gas ritardato di 0.4s dopo l'apice. Il posteriore è stabile: accelera prima.
- **Z-22 Ford Kurve** — trail braking eccessivo (freno fino a 22m dall'apice vs baseline 14m). Rischio sovrasterzo in uscita. Rilascia il freno 5m prima.

---

## [4] Progressione rispetto alla baseline
Giro 2 (1:55.234): **-1.222s** rispetto al giro di calibrazione. Miglioramento lineare nelle zone 5-18. Zone 20-28 ancora da ottimizzare (perdi 0.3s cumulativi).

---

## [5] Sintesi radio
Buon ritmo, BMW. Stai perdendo tre decimi in frenata alla Mercedes e alla Ford Kurve. Anticipa la staccata di dieci metri e apri il gas prima in uscita. Il tuo settore tre è competitivo: mantienilo.`,
  section5_summary:
    "Buon ritmo, BMW. Stai perdendo tre decimi in frenata alla Mercedes e alla Ford Kurve. Anticipa la staccata di dieci metri e apri il gas prima in uscita.",
  created_at: "2026-04-17T08:25:00.000Z",
};

const ANALYSIS_ACE: SessionAnalysisRow = {
  id: -2,
  session_id: -2,
  version: 1,
  template_v3: `## [1] Dati sessione
**Simulatore:** Assetto Corsa EVO · **Auto:** Porsche 718 GT4
**Circuito:** Monza - Circuit · **Giri analizzati:** 2 (giro 2-3)
**Miglior giro:** 1:47.456 (giro 2) · **Δ giri:** +0.436s

---

## [2] Setup
*Nessun setup caricato.*

---

## [3] Analisi tecnica per zona

| Zona | Km | Curva | Problema | Δ |
|---|---|---|---|---|
| Z-04 | 0.18 km | Prima variante | BRAKE_THROTTLE_OVERLAP | -0.09s |
| Z-11 | 0.53 km | Seconda variante | COASTING | -0.11s |
| Z-27 | 1.33 km | Lesmo 2 | LATE_BRAKE | -0.07s |

**Dettaglio:**
- **Z-04 Prima variante** — sovrapposizione freno/gas di 0.3s in ingresso curva. Separa le fasi: frena, poi gas. Stai penalizzando l'assetto anteriore.
- **Z-11 Seconda variante** — 0.7s di coasting tra freno e gas. La Porsche GT4 risponde bene al gas precoce su questo tipo di curva.
- **Z-27 Lesmo 2** — staccata 12m più tardi della baseline. Velocità in uscita 5 km/h sotto. Il grip posteriore è disponibile: anticipa.

---

## [4] Progressione rispetto alla baseline
Giro 2 (1:47.456): **-1.664s** rispetto al giro di calibrazione. Settore 1 in linea con la baseline. Settori 2 e 3 migliorabili di 0.4s ciascuno ottimizzando le varianti e i Lesmo.

---

## [5] Sintesi radio
Porsche, perdi il tempo principalmente alle due varianti. Alla prima, stai sovrapponendo freno e gas: separa le fasi. Alla seconda, entra con più fiducia e apri il gas 0.5 secondi prima. Lesmo 2: anticipa la frenata di 12 metri.`,
  section5_summary:
    "Porsche, perdi il tempo principalmente alle due varianti. Alla prima, stai sovrapponendo freno e gas: separa le fasi. Alla seconda, entra con più fiducia e apri il gas 0.5 secondi prima.",
  created_at: "2026-04-17T14:38:00.000Z",
};

export const MOCK_SESSIONS: SessionRow[] = [
  {
    id: -1,
    game: "r3e",
    car: "10022",
    track: "3045",
    layout: "gp",
    session_type: "Practice",
    started_at: "2026-04-17 08:00:00",
    ended_at: "2026-04-17 08:32:00",
    best_lap: 115.234,
    lap_count: 3,
    car_name: "BMW M4 GT3",
    car_class_name: "GT3",
    track_name: "Nürburgring",
    layout_name: "Grand Prix",
  },
  {
    id: -2,
    game: "ace",
    car: "ks_porsche_718_gt4",
    track: "monza",
    layout: "circuit",
    session_type: "Practice",
    started_at: "2026-04-17 14:00:00",
    ended_at: "2026-04-17 14:45:00",
    best_lap: 107.456,
    lap_count: 3,
    car_name: "Porsche 718 GT4",
    car_class_name: "GT4",
    track_name: "Monza",
    layout_name: "Circuit",
  },
];

const MOCK_LAPS_R3E: LapRow[] = [
  {
    id: -101,
    session_id: -1,
    setup_id: null,
    lap_number: 1,
    lap_time: 118.456,
    sector1: 38.2,
    sector2: 42.1,
    sector3: 38.156,
    valid: false,
    zones_json: null,
    recorded_at: "2026-04-17T08:08:00.000Z",
  },
  {
    id: -102,
    session_id: -1,
    setup_id: null,
    lap_number: 2,
    lap_time: 115.234,
    sector1: 37.1,
    sector2: 40.8,
    sector3: 37.334,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T08:17:00.000Z",
  },
  {
    id: -103,
    session_id: -1,
    setup_id: null,
    lap_number: 3,
    lap_time: 115.78,
    sector1: 37.3,
    sector2: 41.0,
    sector3: 37.48,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T08:25:00.000Z",
  },
];

const MOCK_LAPS_ACE: LapRow[] = [
  {
    id: -201,
    session_id: -2,
    setup_id: null,
    lap_number: 1,
    lap_time: 109.12,
    sector1: 34.5,
    sector2: 40.3,
    sector3: 34.32,
    valid: false,
    zones_json: null,
    recorded_at: "2026-04-17T14:09:00.000Z",
  },
  {
    id: -202,
    session_id: -2,
    setup_id: null,
    lap_number: 2,
    lap_time: 107.456,
    sector1: 33.8,
    sector2: 39.7,
    sector3: 33.956,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T14:18:00.000Z",
  },
  {
    id: -203,
    session_id: -2,
    setup_id: null,
    lap_number: 3,
    lap_time: 107.892,
    sector1: 33.9,
    sector2: 39.9,
    sector3: 34.092,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T14:27:00.000Z",
  },
];

export const MOCK_DETAILS: Record<number, SessionDetail> = {
  [-1]: {
    session: MOCK_SESSIONS[0],
    laps: MOCK_LAPS_R3E,
    setups: [],
    analyses: [ANALYSIS_R3E],
  },
  [-2]: {
    session: MOCK_SESSIONS[1],
    laps: MOCK_LAPS_ACE,
    setups: [],
    analyses: [ANALYSIS_ACE],
  },
};
