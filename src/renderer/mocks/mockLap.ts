/**
 * mockLap — dati fittizi per testare lo storico senza una sessione reale.
 * Usato quando mockHistoryMode è attivo nelle impostazioni.
 * Il lapId è -1 per distinguerlo da giri reali nel DB.
 */

import type { LapAnalysis, LapRowFull, SetupData } from "../../shared/types";

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

const MOCK_ANALYSIS_ACE: LapAnalysis = {
  lapNumber: 3,
  lapTime: 102.874,
  templateV3: `[1] Sintesi giro
Tempo: 1:42.874 | Settori: S1 32.510 · S2 36.122 · S3 34.242
Giro valido. Baseline stabilizzata al giro 2.

[2] Frenata
- **Curva Grande (dist 210m):** Punto di frenata anticipato di 6m. Margine per posticipare.
- **Roggia (dist 520m):** Frenata corretta, breve picco ABS (0.2s) — accettabile.
- **Lesmo 1 (dist 780m):** Trail braking di 0.18s oltre la corda — penalizza la trazione.
- **Ascari (dist 1180m):** Frenata ottimale, nessuna anomalia rilevata.

[3] Gas e trazione
- **Uscita Curva Grande:** Apertura gas 0.12s in ritardo rispetto al baseline.
- **Uscita Roggia:** Progressione fluida — ben eseguito.
- **Uscita Lesmo 1:** TC attivato 3 volte in uscita. Ridurre il gas anticipato.
- **Parabolica:** Throttle al 100% raggiunto a 45m dalla corda — ottimale.

[4] Traiettoria e sterzata
- **Curva Grande:** Corda raggiunta correttamente, uscita pulita.
- **Lesmo 2:** Ingresso leggermente largo, picco di steer 0.61. Valutare traiettoria più stretta.
- **Ascari:** Cambio direzionale fluido, nessun sottosterzo.
- **Parabolica:** Traiettoria progressiva corretta — ottima uscita sul rettilineo.

[5] Riepilogo e prossimo giro
Giro solido su Monza. I tre punti da correggere nel prossimo giro sono:
1. Posticipare il punto di frenata alla Curva Grande di circa 6m.
2. Ridurre il trail braking al Lesmo 1 per migliorare la trazione in uscita.
3. Aprire il gas 0.12s prima in uscita dalla Curva Grande.
Potenziale stimato di miglioramento: 0.4–0.6s.`,
  section5Summary:
    "Giro solido. Priorità: frena 6m più tardi alla Curva Grande, riduci il trail al Lesmo 1, apri il gas prima in uscita dalla Curva Grande.",
  generatedAt: "2026-04-17T09:15:00.000Z",
};

const MOCK_SETUP_ACE: SetupData = {
  carVerified: true,
  carFound: "Porsche 718 GT4",
  setupText: "",
  params: [
    { category: "Aerodinamica", parameter: "Ala anteriore", value: "3" },
    { category: "Aerodinamica", parameter: "Ala posteriore", value: "5" },
    { category: "Sospensioni", parameter: "Altezza ant. (mm)", value: "58" },
    { category: "Sospensioni", parameter: "Altezza post. (mm)", value: "64" },
    { category: "Sospensioni", parameter: "ARB anteriore", value: "2" },
    { category: "Sospensioni", parameter: "ARB posteriore", value: "3" },
    { category: "Freni", parameter: "Bias frenante (%)", value: "56" },
    { category: "Elettronica", parameter: "TC", value: "4" },
    { category: "Elettronica", parameter: "ABS", value: "3" },
    { category: "Gomme", parameter: "Pressione ant. (psi)", value: "26.5" },
    { category: "Gomme", parameter: "Pressione post. (psi)", value: "25.8" },
    { category: "Trasmissione", parameter: "Rapporto sterzo", value: "13.5" },
  ],
  screenshots: [],
};

export const MOCK_LAP_ACE: LapRowFull = {
  id: -2,
  session_id: -2,
  lap_number: 3,
  lap_time: 102.874,
  sector1: 32.51,
  sector2: 36.122,
  sector3: 34.242,
  valid: true,
  analysis_json: JSON.stringify(MOCK_ANALYSIS_ACE),
  pdf_path: null,
  setup_json: JSON.stringify(MOCK_SETUP_ACE),
  setup_screenshots: null,
  recorded_at: "2026-04-17T09:12:00.000Z",
  car: "ks_porsche_718_gt4",
  track: "monza",
  layout: "monza",
  game: "ace",
  car_name: "Porsche 718 GT4",
  track_name: "Monza",
  layout_name: "Monza",
  car_class_name: "",
};

export const MOCK_LAP: LapRowFull = {
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
  car: "0",
  track: "0",
  layout: "0",
  game: "r3e",
  car_name: "Porsche 911 GT3 Cup",
  track_name: "Zandvoort",
  layout_name: "Grand Prix",
  car_class_name: "GT3 Cup",
};
