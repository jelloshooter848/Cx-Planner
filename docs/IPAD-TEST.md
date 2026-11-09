# Field app: real iPad test

Emulation passed, but only a real iPad shows how Safari behaves. This takes about 15 minutes.

## Before you start
1. Enable GitHub Pages once: repo **Settings → Pages → Source: GitHub Actions**.
2. Run the **Field app (GitHub Pages)** workflow (Actions tab → Run workflow). It prints the app's URL.

## Steps
| # | Do this | Expect |
|---|---|---|
| 1 | Open the URL in Safari on the iPad | App loads, packet list on the left |
| 2 | Share → **Add to Home Screen**, then open it from the home screen | Opens full screen, no Safari bars |
| 3 | Open **Device checks** → tap **Request persistent storage** | Note what "Persistent storage" says |
| 4 | Tap **Load sample packet**, open the checklist | Two panes in landscape and portrait |
| 5 | Turn on **Airplane Mode**, close the app fully, reopen it | App and packet still there |
| 6 | Answer all 6 items, change one answer | Highlight follows the latest tap |
| 7 | Review and sign: initials, sign with finger **and** with Apple Pencil | Line follows the pen, page doesn't scroll |
| 8 | Mark complete, then **Export results** | Share sheet opens; try AirDrop or Save to Files |
| 9 | Email yourself the sample packet from step 8's folder (or any `.cxpk`) and open it via **Open packet file** | Files app lets you pick it (not greyed out) |
| 10 | Leave the app unused for 8+ days, then reopen | Packets and unsent results still there |

## Report back
For each step: OK, or what happened. Also: iPad model, iPadOS version, and the four values from **Device checks**.
