# 🃏 Twenty-Eight (28) — Royal Casino Multiplayer Edition

A real-time multiplayer implementation of the classic South Asian trick-taking card game **Twenty-Eight (28)**, adapted from ESP32 embedded microcontrollers into a web application designed for **Streamlit** and internet play.

Powered by **WebRTC DataChannels (PeerJS)** and procedural **Web Audio API** sound effects, this game connects up to 4 players and table displays worldwide with sub-50ms latency, zero port forwarding, and seamless NAT traversal.

![Deployment](https://img.shields.io/badge/Deploy-Vercel-000000?style=for-the-badge&logo=Vercel)
![Multiplayer](https://img.shields.io/badge/Multiplayer-WebRTC%20P2P-38BDF8?style=for-the-badge)
![Platform](https://img.shields.io/badge/Mobile-Native%20PWA%20Ready-22C55E?style=for-the-badge)

---

## ✨ Features

- **🌐 Worldwide Real-Time Multiplayer:**
  - Create or join custom rooms with a simple 5-character Room Code (e.g., `ROYAL28`).
  - Peer-to-peer WebRTC DataChannels: low latency, encrypted, no blocked secondary ports on Streamlit Cloud.
  - One-click invite link copying & dynamic QR code generation for mobile phone joining.
- **📱 Multi-Device Flexibility:**
  - **Full Table View:** Complete casino experience with card fans, opponent cards, trick pile, scores, and log drawer.
  - **Hand Controller Mode:** Optimized for mobile phones as personal handheld controllers when playing with a shared TV or tablet.
  - **Center Table / TV Display Mode (`BOARD`):** Large shared display mode ideal for casting to an iPad or TV screen in the room.
  - **Single Player vs AI:** Instant offline match against 3 Grandmaster AI bots.
- **👑 Authentic Twenty-Eight Game Rules:**
  - 32-card deck (J, 9, A, 10, K, Q, 8, 7 across 4 suits) totaling **28 card points**.
  - 4-card First Deal $\rightarrow$ Auction Bidding phase (min bid 16, up to 28).
  - Secret Trump selection: bidder places lowest card of trump suit face-down.
  - 4-card Second Deal (8 cards total per hand).
  - Lead-follow trick taking, Void tracking, and on-demand **Trump Reveal** mechanics.
  - **Royal K-Q Pair Declaration** ($\pm 4$ target points).
  - Authentic Game Points penalty/reward system based on bid tier.
- **🔊 Procedural Web Audio:**
  - Built-in Web Audio API sound synthesis (deal whoosh, card play, victory chime, dramatic trump reveal fanfare) without requiring external MP3 assets.
- **🎨 Custom Casino Themes:**
  - Royal Emerald Green
  - Midnight Sapphire Blue
  - Crimson Velvet Casino

---

## 🎴 Card Values & Ranking

Total card points in deck = **28 PTS**

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

## 🚀 Quickstart (Local)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/prabhav22-stack/twenty-eight-game.git
   cd twenty-eight-game
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the Streamlit app:**
   ```bash
   python -m streamlit run app.py
   ```
   Open your browser at `http://localhost:8501`.

---

## ⚡ 1-Click Deploy to Vercel (Recommended for Mobile)

1. Push or fork this repository to your GitHub.
2. Go to [vercel.com](https://vercel.com) and log in.
3. Click **Add New...** -> **Project**.
4. Import `twenty-eight-game` (select branch `vercel`).
5. Framework Preset: **Other** (Static Site). Root Directory: `./`.
6. Click **Deploy**!
   Your game is now live globally at `https://<your-project>.vercel.app` with instant <200ms load times and full-screen mobile PWA support.

---

## 📱 How to Play Multiplayer Across Devices

1. **Host:** Open the app, enter a room code (e.g. `CARD28`), and click **Join / Host Table**. You will be assigned **SOUTH (Host / Team 1)**.
2. **Invite Friends:**
   - Click the **Invite** button at the top or open the sidebar to display the **QR Code**.
   - Friends can scan the QR code with their phone cameras to join directly into your room!
   - Seats are automatically assigned:
     - Player 1 = SOUTH (Host • Team 1)
     - Player 2 = NORTH (Partner • Team 1)
     - Player 3 = EAST (Opponent • Team 2)
     - Player 4 = WEST (Opponent • Team 2)
3. **Optional TV Board Mode:**
   - Open the room link on a TV or tablet browser with `?mode=BOARD` or select "Center Table / TV Display" to have a shared central board.
4. **Start Match:**
   - The host can click **Start Match** at any time. Any unoccupied seats are automatically controlled by intelligent AI bots!

---

## 📜 License
MIT License. Created for the Twenty-Eight card game community.
