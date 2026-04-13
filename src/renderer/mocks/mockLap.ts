/**
 * mockLap — dati fittizi per testare lo storico senza una sessione reale.
 * Usato quando mockHistoryMode è attivo nelle impostazioni.
 * Il lapId è -1 per distinguerlo da giri reali nel DB.
 */

import type { LapAnalysis, LapRow, SetupData } from "../../shared/types";

const MOCK_ANALYSIS: LapAnalysis = {
  lapNumber: 7,
  lapTime: 118.452,
  templateV3: `[1] Sintesi giro
Tempo: 1:58.452 | Settori: S1 38.210 · S2 41.887 · S3 38.355
Giro valido. Miglioramento di 0.8s rispetto al giro precedente.

[2] Frenata
- **Curva 1 (dist 180m):** Frenata 8m in anticipo rispetto alla baseline. Punto di frenata a 95m dalla corda — ottimale.
- **Curva 4 (dist 540m):** Rilascio freno lento (+0.12s di trail braking eccessivo). Penalizza la trazione in uscita.
- **Curva 7 (dist 920m):** Frenata corretta, breve bloccaggio ABS (0.3s) — verificare la pressione in ingresso.
- **Curvone (dist 1240m):** Nessuna frenata rilevata — corretto per questa sezione ad alta velocità.

[3] Gas e trazione
- **Uscita curva 1:** Apertura gas a 82m dalla corda, 0.15s dopo il baseline. Margine di miglioramento.
- **Uscita curva 4:** Gas anticipato di 0.2s rispetto al baseline — rischio pattinamento rilevato (TC attivato 2 volte).
- **Uscita curva 7:** Progressione gas fluida e ottimale. Ben eseguito.
- **Rettilineo principale:** Throttle al 100% per 3.1s — corretto.

[4] Traiettoria e sterzata
- **Curva 1:** Corda raggiunta con 0.3m di ritardo laterale. Sterzata leggermente brusca in ingresso (picco steer 0.72).
- **Curva 4:** Traiettoria corretta, uscita pulita verso il muretto.
- **Curva 7:** Sottosterzo lieve in ingresso (steer 0.68 con ABS attivo). Considerare ingresso più largo.
- **Chicane (dist 1540m):** Cambio di direzione fluido, nessuna anomalia.

[5] Riepilogo e prossimo giro
Buon giro nel complesso. I punti prioritari per il giro successivo sono:
1. Anticipare l'apertura gas in uscita curva 1 di circa 0.15s.
2. Ridurre il trail braking in curva 4 per migliorare la trazione.
3. Valutare un ingresso più largo in curva 7 per limitare il sottosterzo con ABS.
Potenziale stimato di miglioramento: 0.5–0.8s con queste correzioni.`,
  section5Summary:
    "Buon giro. Priorità: anticipa il gas in uscita curva 1, riduci il trail braking in curva 4, e prova un ingresso più largo in curva 7.",
  generatedAt: "2026-04-13T10:30:00.000Z",
};

const MOCK_SETUP: SetupData = {
  carVerified: true,
  carFound: "Porsche 911 GT3 Cup",
  setupText: "",
  params: [
    { category: "Aerodinamica", parameter: "Ala anteriore", value: "4" },
    { category: "Aerodinamica", parameter: "Ala posteriore", value: "6" },
    { category: "Sospensioni", parameter: "Altezza ant. (mm)", value: "62" },
    { category: "Sospensioni", parameter: "Altezza post. (mm)", value: "68" },
    { category: "Sospensioni", parameter: "Barra anteriore", value: "3" },
    { category: "Sospensioni", parameter: "Barra posteriore", value: "4" },
    { category: "Freni", parameter: "Ripartizione frenante", value: "55%" },
    { category: "Freni", parameter: "Pressione freni", value: "85%" },
    { category: "Gomme", parameter: "Pressione ant. (psi)", value: "27.5" },
    { category: "Gomme", parameter: "Pressione post. (psi)", value: "26.8" },
    { category: "Trasmissione", parameter: "Differenziale (ingresso)", value: "20%" },
    { category: "Trasmissione", parameter: "Differenziale (uscita)", value: "40%" },
  ],
  screenshots: [],
};

export const MOCK_LAP: LapRow = {
  id: -1,
  session_id: -1,
  lap_number: 7,
  lap_time: 118.452,
  sector1: 38.21,
  sector2: 41.887,
  sector3: 38.355,
  valid: true,
  analysis_json: JSON.stringify(MOCK_ANALYSIS),
  pdf_path: null,
  setup_json: JSON.stringify(MOCK_SETUP),
  setup_screenshots: JSON.stringify([]),
  recorded_at: "2026-04-13T10:28:00.000Z",
};

export const MOCK_CAR = "Porsche 911 GT3 Cup";
export const MOCK_TRACK = "Zandvoort";
