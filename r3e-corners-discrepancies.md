# Discrepanze tra r3e-corners.ts originale e r3e-data.json

Rilevate durante la conversione da nomi stringa a ID numerici.

---

## Nomi tracciato errati (track name mismatch)

| Nome in r3e-corners.ts | Nome corretto in r3e-data.json | Track ID | Tipo |
|---|---|---|---|
| `Bilsterberg` | `Bilster Berg` | 7818 | Typo (spazio mancante) |
| `Automotodrom Brno` | `Brno` | 5297 | Nome diverso |
| `Hockenheinring` | `Hockenheimring` | 1692 | Typo (lettera 'e' in più) |
| `Alemanenring` | `Alemannenring` | 12936 | Typo ('n' mancante) |
| `M.A. Oschersleben 2024` | `Motorsport Arena Oschersleben 2024` | 12505 | Nome abbreviato |
| `Adria Intern. Raceway 2003` | `Adria International Raceway 2003` | 13350 | Nome abbreviato |
| `Adria Intern. Raceway 2021` | `Adria International Raceway 2021` | 13424 | Nome abbreviato |

---

## Nomi layout errati (layout name mismatch)

| Tracciato | Layout in r3e-corners.ts | Layout corretto | Layout ID | Tipo |
|---|---|---|---|---|
| `Automotodrom Brno` | `Gand Prix` | `Grand Prix` | 5298 | Typo |
| `Nordschleife` | `VLN` | `NLS` | 4975 | Layout rinominato nel gioco |
| `Portimao Circuit` | `National` | `Moto` | 1783 | Nome diverso |
| `Portimao Circuit` | `Club` | `Short` | 1785 | Nome diverso |
| `Portimao Circuit` | `Club Chicane` | `Chicane` | 1784 | Nome diverso |

---

## Tracciato ambiguo (due versioni in r3e-data.json)

`Circuit Zandvoort` in r3e-corners.ts aveva layout misti appartenenti a due tracciati distinti:

| Layout in r3e-corners.ts | Tracciato assegnato | Track ID | Layout ID |
|---|---|---|---|
| `National` | `Circuit Zandvoort 2019` | 1677 | 1680 |
| `Club` | `Circuit Zandvoort 2019` | 1677 | 1679 |
| `Grand Prix` | `Circuit Zandvoort` | 10781 | 10782 |
| `Short` | `Circuit Zandvoort` | 10781 | 11090 |

---

## Tracciato rimosso dal gioco

| Tracciato | Layout presenti | Azione |
|---|---|---|
| `Scandinavian Raceway` | `Grand Prix`, `South` | Voci eliminate (tracciato non presente in r3e-data.json) |
