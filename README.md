# 🃏 Twenty-Eight (28) — Royal Casino Multiplayer Edition

A modern, high-performance web and mobile implementation of the classic South Asian trick-taking card game **Twenty-Eight (28)**, featuring real-time peer-to-peer multiplayer, intelligent humanlike Python AI bots, authentic rules, and bilingual localization (English & Hindi).

Powered by **WebRTC DataChannels (PeerJS)**, **Vercel Serverless Python Backend**, and procedural **Web Audio API** sound synthesis, this game connects up to 4 players worldwide with sub-50ms latency, zero port forwarding, and seamless cross-device play.

![Deployment](https://img.shields.io/badge/Deploy-Vercel-000000?style=for-the-badge&logo=Vercel)
![Multiplayer](https://img.shields.io/badge/Multiplayer-WebRTC%20P2P-38BDF8?style=for-the-badge)
![AI Engine](https://img.shields.io/badge/AI%20Engine-Python%20Serverless-F59E0B?style=for-the-badge&logo=python)
![Bilingual](https://img.shields.io/badge/Language-English%20%7C%20%E0%A4%B9%E0%A4%BF%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%80-10B981?style=for-the-badge)
![Platform](https://img.shields.io/badge/Mobile-Native%20PWA%20Ready-22C55E?style=for-the-badge)

---

## ✨ Features

- **🌐 Worldwide Real-Time Multiplayer:**
  - Create or join rooms with a custom room code.
  - Direct peer-to-peer WebRTC DataChannels: low latency, encrypted, and NAT-traversing.
  - One-click invite link copying & dynamic QR code generation for effortless mobile joining.
- **🧠 Humanlike AI Intelligence Backend:**
  - Powered by a Python serverless API (`/api/bid`, `/api/trump`, `/api/play`, `/api/deal`).
  - **Card Counting & Boss Tracking:** Dynamically identifies master cards (e.g. Jacks, or Nines when Jacks have fallen).
  - **Strategic Smearing:** AI partners feed point-bearing cards (10s, 9s, Aces) into tricks that your team is safely winning.
  - **Smart Ducking:** Conserves high cards and drops 0-point spot cards (7s and 8s) when opponents hold unbeatable tricks.
  - **Cheapest Winner Selection:** Wins tricks in 4th seat using the lowest card necessary to preserve key honors.
  - **Balanced Pacing:** Natural, deliberate decision delays (1.75s) for clear readability of every play and bid.
- **👑 Authentic Twenty-Eight (28) Rules:**
  - Standard 32-card deck (J, 9, A, 10, K, Q, 8, 7 across 4 suits) totaling **28 card points**.
  - **Phase 1 (4-card Deal) & Auction:** Interactive bidding from 16 up to 28, with full pass tracking and partner indicators.
  - **0-Point Hand Reshuffle (Re-deal):** Provision to request an immediate reshuffle if dealt 0 total points across your initial 4 cards.
  - **Secret Trump Selection:** Winning bidder locks in their secret trump suit before the second deal.
  - **Phase 2 (Second 4-card Deal):** 8 cards total per player.
  - **Strict Trump Reveal Mechanics:** Follow-suit rules strictly enforced; trump can only be revealed when void in the led suit (and cannot be opened by the trick leader).
  - **Royal K-Q Pair Declaration:** Declarable by players holding King and Queen of the trump suit ($\pm 4$ target adjustment).
  - Authentic Game Points penalty and reward scoring system.
- **🌐 Bilingual Localization (English & हिन्दी):**
  - Instant one-tap switching between English and Hindi for all cards, HUD elements, bidding modals, and logs.
- **📱 Responsive Mobile-First Design:**
  - Clustered center trick table perfectly contained within the circular casino arena.
  - Dynamic dense-hand fan scaling for narrow mobile screens ensuring cards never clip outside viewport boundaries.
  - Dynamic glowing HUD indicator showing the current trick leader and winning team in real time.
- **🔊 Procedural Web Audio:**
  - Procedural Web Audio API sound synthesis (deal whoosh, card play, trick chime, victory fanfare) without heavy external assets.
- **🎨 Custom Casino Themes:**
  - Royal Emerald Green
  - Midnight Sapphire Blue
  - Crimson Velvet Casino

---

## 🎴 Card Values & Ranking

Total points in the 32-card deck = **28 PTS**

| Rank | Card Points | Power Ranking |
| :--- | :---: | :---: |
| **Jack (J)** | **3 PTS** | 1st (Highest) |
| **Nine (9)** | **2 PTS** | 2nd |
| **Ace (A)** | **1 PT** | 3rd |
| **Ten (10)** | **1 PT** | 4th |
| **King (K)** | 0 PTS | 5th |
| **Queen (Q)** | 0 PTS | 6th |
| **Eight (8)** | 0 PTS | 7th |
| **Seven (7)** | 0 PTS | 8th (Lowest) |

---

## 🚀 Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/prabhav22-stack/twenty-eight-game.git
   cd twenty-eight-game
   ```

2. **Run a local server:**
   - Using Python built-in server:
     ```bash
     python -m http.server 8000
     ```
   - Or using Node/npx:
     ```bash
     npx serve .
     ```

3. Open your browser at `http://localhost:8000`.

---

## ⚡ Deployment on Vercel

The application is pre-configured with `vercel.json` and serverless Python API handlers under `/api`:

1. Push or fork this repository to GitHub.
2. Link your repository in [Vercel](https://vercel.com).
3. Root Directory: `./` (Vercel automatically detects the static frontend and Python serverless functions).
4. Click **Deploy**!

---

## 📱 How to Play

1. **Start Single Player:**
   - Tap **Single Player vs AI** on the home screen to instantly play offline against 3 intelligent AI bots.
2. **Host Multiplayer:**
   - Enter a room code and click **Create & Host Room**. You are assigned **SOUTH (Host • Team 1)**.
   - Share the invite link or have friends scan the on-screen **QR code**.
   - Seats are automatically assigned:
     - Player 1 = SOUTH (Host • Team 1)
     - Player 2 = NORTH (Partner • Team 1)
     - Player 3 = EAST (Opponent • Team 2)
     - Player 4 = WEST (Opponent • Team 2)
   - Tap **Start Match** at any time. Any unoccupied seats are automatically controlled by the AI engine!

---

## 📜 License
MIT License. Created for the Twenty-Eight card game community.
