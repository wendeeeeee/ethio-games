# ethio-games 👑🃏

Authentic Ethiopian Card Games Platform featuring **Conquer (ኮንከር)** and **Seka (ሴካ)** with real-time multiplayer, AI bot mode, sound design, and mobile-first responsive gameplay.

---

## 🎮 Included Games

### 1. 👑 Ethiopian Conquer (ኮንከር)
The complete and authentic 14-rule Ethiopian Conquer card betting game:
- **14 Rules Engine**:
  1. *Yemejemeria ye meret* (Protected initial ground discard)
  2. *Joker Naming* (Joiner blind cut: High, Low, Same, Opposite)
  3. *Golden Star (⭐)* wild card badge
  4. *41 + Tris* required to draw from ground
  5. *ተጣይ (Winning Discard)*: Meld 13 cards and discard the 14th card to ground
  6. *Joker Drop*: Accidental Joker discard can be claimed by opponent
  7. *Endless Deck*: Continuous reshuffle on empty deck
  8. *Poke & 30s Countdown Forfeit*
  9. *Joker Swap*: Replace table Jokers with natural cards
  10. *4 Aces*: Quatris of Aces unlocks ground draw
  11. *J-Q-K-A*: Consecutive 4-card run counts as 41 points
  12. *Base Card Win*
  13. *Joker Steal*
  14. *1 Joker Limit per Tris/Quatris*

### 2. 🃏 Ethiopian Seka (ሴካ)
The classic Ethiopian 10-card / 11-card game:
- **54-card deck** with 2 wild Jokers
- **Strict Sequences Only**: Melds must be suited runs (same-rank sets like 7♠ 7♥ 7♦ are not allowed)
- **4-Card Quatris & 3-Card Tris** combinations (e.g. 2 Tris + 1 Quatris = 10 cards)
- **Free Ground Pickup**: Any player can pick up from ground without 41-point restrictions
- **No Consecutive Jokers Rule**: Multiple jokers are automatically distributed to avoid consecutive jokers
- **Optimal Auto-Arrangement ("ደርድር")**: Intelligently groups runs and positions Jokers seamlessly

---

## ✨ Features

- 📱 **Mobile & Desktop Responsive**: Custom responsive fan geometry for iPhone Mini, SE, standard smartphones, tablets, and desktop displays.
- 👤 **Fast User Registration**: Player registration with Name + Phone Number formatted for **Telebirr** and **CBE Birr** payouts with a 1,000 ETB starting bonus.
- ⏱️ **1-Minute Table Expiration**: Tables automatically expire after 60 seconds if no opponent joins, releasing any stakes and notifying the creator.
- 🤖 **Single Player vs AI Bot**: Instant offline testing against intelligent AI bots for both Conquer and Seka.
- 🌐 **Real-time Multiplayer**: Powered by Socket.io with low latency state synchronization.
- 🔊 **Web Audio Sound Engine**: Realistic card snapping, sliding, shuffling, and chime effects.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- npm

### Installation
```bash
# Clone the repository
git clone https://github.com/wendeeeeee/ethio-games.git
cd ethio-games

# Install dependencies
npm install

# Start the game server
npm start
```

Visit **http://localhost:3000** in your web browser.

---

## 🛠️ Tech Stack
- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 (Mobile-first responsive design, Web Audio API)
- **Architecture**: Modular game engines (`engine/conquerRules.js`, `engine/sekaRules.js`, `engine/gameRoom.js`, `engine/sekaGameRoom.js`, `engine/walletManager.js`)
