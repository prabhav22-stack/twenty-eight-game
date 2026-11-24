/**
 * i18n.js - Internationalization Engine (English & Hindi)
 * Localized labels, suit names, announcements, and button text.
 */
const I18N = {
    en: {
        appName: "TWENTY-EIGHT",
        subtitle: "Royal Casino Multiplayer Edition",
        nicknameLabel: "Your Nickname",
        roomCodeLabel: "Room Code",
        onlineMultiplayer: "🌐 Online Multiplayer",
        createRoom: "👑 Create & Host Room",
        createRoomSub: "Starts as SOUTH (Host)",
        joinRoom: "⚡ Join Existing Room",
        joinRoomSub: "Connect to Host",
        offlinePractice: "🤖 Offline Practice",
        singlePlayer: "Single Player vs AI",
        singlePlayerSub: "Instant Offline Match",
        startMatch: "🏁 START MATCH (FILL EMPTY WITH AI)",
        inviteBtn: "🔗 View Invite Link & QR Code",
        resetLobby: "🔄 Reset Lobby",
        connecting: "Connecting to Royal Room",
        youAreHost: "👑 You are ROOM HOST",
        shareCodeMsg: "Share the code or tap 'Invite' for QR code!",
        waitingForHost: "Waiting for Host to start match...",
        allSeatsFull: "All 4 seats (S/E/N/W) are full! Spectating.",
        yourTeam: "Your Team",
        opponents: "Opponents",
        bidding: "BIDDING",
        phase1: "Phase 1 (4 Cards)",
        secretTrump: "🔒 Secret Trump",
        trump: "TRUMP",
        auctionInProgress: "Auction in progress...",
        minBid: "Min Bid: 16",
        waitingToLead: "Waiting for {name} to lead",
        isLeading: "{name} is leading the trick...",
        trickPot: "Trick Pot",
        trickZero: "Trick: 0 pts",
        lead: "Lead",
        high: "High",
        winning: "Winning",
        placeBid: "Place Your Bid",
        currentHighBid: "Current High Bid:",
        noneMin16: "None (Min 16)",
        handPoints: "Your 4-Card Hand Points: {pts} pts",
        passTurn: "Pass Turn",
        partnerLabel: "PARTNER ({dir})",
        partnerWaiting: "WAITING...",
        partnerPassed: "PASSED",
        partnerBid: "BIDS {val}",
        partnerWonBid: "WON BID!",
        partnerHasNotBid: "WAITING...",
        passedSkipped: "PASSED (SKIPPED)",
        decidingBid: "is deciding bid...",
        selectTrump: "Select Secret Trump Suit",
        selectTrumpSub: "Choose your secret trump suit for this round:",
        revealTrump: "🚨 Reveal Trump",
        declarePair: "👑 Declare K-Q Pair",
        reshuffleZeroPts: "🔄 Reshuffle Deck (0 Pts Hand)",
        reshufflePrompt: "⚠️ 0 Points in hand! Reshuffle requested by {name}.",
        reshuffleSuccess: "🔄 Redeal: Fresh 4-card hands dealt!",
        pairDeclared: "👑 K-Q PAIR DECLARED",
        roundComplete: "Round Complete",
        dealNextRound: "Deal Next Round",
        inviteTitle: "👑 Invite Friends",
        inviteSub: "Scan on phone or share room code:",
        copyInvite: "📋 Copy Invite Link",
        close: "Close",
        copiedToast: "Invite link copied to clipboard!",
        langBtn: "🌐 हिन्दी",
        logTitle: "📜 Game Log & History",
        logBtn: "Log",
        team1Won: "🎉 TEAM 1 (S & N) WON!",
        team1Defeated: "💀 TEAM 1 (S & N) DEFEATED!",
        team2Won: "🎉 TEAM 2 (E & W) WON!",
        team2Defeated: "💀 TEAM 2 (E & W) DEFEATED!",
        yourTeamWon: "🎉 YOUR TEAM WON!",
        yourTeamDefeated: "💀 YOUR TEAM WAS DEFEATED!",
        opponentTeamWon: "🏆 OPPONENT TEAM WON!",
        opponentTeamDefeated: "💀 OPPONENT TEAM WAS DEFEATED!",
        viewTacticalAnalysis: "🧠 View AI Tactical Analysis",
        hideTacticalAnalysis: "🧠 Hide AI Tactical Analysis",
        gamePtsWon: "Game Point(s) Won!",
        gamePtsPenalty: "Game Point(s) Penalty!",
        pts: "pts",
        diffLabel: "AI Difficulty",
        diffEasy: "Easy",
        diffMedium: "Medium",
        diffHard: "Hard",
        diffDescEasy: "Easy: No AI involvement in enemy bots. Relaxed match.",
        diffDescMedium: "Medium: Moderate AI involvement. Balanced strategic challenge.",
        diffDescHard: "Hard: Grandmaster AI with card counting and aggressive tactics.",
        suits: { '♠': '♠ Spades', '♥': '♥ Hearts', '♣': '♣ Clubs', '♦': '♦ Diamonds' },
        dirs: { SOUTH: 'SOUTH', NORTH: 'NORTH', EAST: 'EAST', WEST: 'WEST' }
    },
    hi: {
        appName: "अट्ठाइस (28)",
        subtitle: "रॉयल कसीनो मल्टीप्लेयर एडिशन",
        nicknameLabel: "आपका नाम (Nickname)",
        roomCodeLabel: "कमरा कोड (Room Code)",
        onlineMultiplayer: "🌐 ऑनलाइन मल्टीप्लेयर",
        createRoom: "👑 नया कमरा बनाएं (Host)",
        createRoomSub: "साउथ (होस्ट) के रूप में शुरू करें",
        joinRoom: "⚡ कमरे में जुड़ें (Join)",
        joinRoomSub: "होस्ट के कमरे से जुड़ें",
        offlinePractice: "🤖 ऑफलाइन अभ्यास",
        singlePlayer: "कंप्यूटर (AI) के खिलाफ खेलें",
        singlePlayerSub: "तुरंत ऑफलाइन मैच शुरू करें",
        startMatch: "🏁 खेल शुरू करें (AI जोड़ें)",
        inviteBtn: "🔗 आमंत्रण लिंक व QR कोड देखें",
        resetLobby: "🔄 लॉबी रीसेट करें",
        connecting: "रॉयल रूम से कनेक्ट हो रहा है",
        youAreHost: "👑 आप रूम होस्ट हैं",
        shareCodeMsg: "कोड शेयर करें या QR कोड देखने के लिए 'Invite' दबाएं!",
        waitingForHost: "होस्ट द्वारा खेल शुरू करने की प्रतीक्षा...",
        allSeatsFull: "सभी 4 सीटें भरी हैं! दर्शक मोड।",
        yourTeam: "आपकी टीम",
        opponents: "विरोधी टीम",
        bidding: "बोली (Bidding)",
        phase1: "चरण 1 (4 पत्ते)",
        secretTrump: "🔒 गुप्त हुकुम",
        trump: "हुकुम (Trump)",
        auctionInProgress: "बोली जारी है...",
        minBid: "न्यूनतम बोली: 16",
        waitingToLead: "{name} की चाल की प्रतीक्षा",
        isLeading: "{name} चाल चल रहे हैं...",
        trickPot: "चाल के अंक",
        trickZero: "चाल: 0 अंक",
        lead: "रंग",
        high: "बड़ा पत्ता",
        winning: "जीत रहे हैं",
        placeBid: "अपनी बोली लगाएं",
        currentHighBid: "वर्तमान उच्चतम बोली:",
        noneMin16: "कोई नहीं (न्यूनतम 16)",
        handPoints: "आपके 4 पत्तों के अंक: {pts} अंक",
        passTurn: "पास करें (Pass)",
        partnerLabel: "साथी ({dir})",
        partnerWaiting: "प्रतीक्षा में...",
        partnerPassed: "पास किया",
        partnerBid: "बोली {val}",
        partnerWonBid: "बोली जीती!",
        partnerHasNotBid: "प्रतीक्षा में...",
        passedSkipped: "पास किया (स्किप)",
        decidingBid: "की बोली की प्रतीक्षा...",
        selectTrump: "गुप्त हुकुम का रंग चुनें",
        selectTrumpSub: "इस राउंड के लिए गुप्त हुकुम चुनें:",
        revealTrump: "🚨 हुकुम खोलें",
        declarePair: "👑 रॉयल K-Q जोड़ी घोषणा",
        reshuffleZeroPts: "🔄 पत्ते दोबारा बांटें (0 अंक हाथ)",
        reshufflePrompt: "⚠️ हाथ में 0 अंक हैं! {name} ने री-शफल मांगा।",
        reshuffleSuccess: "🔄 नए 4 पत्ते दोबारा बांटे गए!",
        pairDeclared: "👑 K-Q जोड़ी घोषित",
        roundComplete: "राउंड समाप्त",
        dealNextRound: "अगला राउंड खेलें",
        inviteTitle: "👑 दोस्तों को आमंत्रित करें",
        inviteSub: "फोन से स्कैन करें या कोड शेयर करें:",
        copyInvite: "📋 लिंक कॉपी करें",
        close: "बंद करें",
        copiedToast: "लिंक क्लिपबोर्ड पर कॉपी हो गया!",
        langBtn: "🌐 English",
        logTitle: "📜 खेल इतिहास व लॉग",
        logBtn: "लॉग",
        team1Won: "🎉 टीम 1 (साउथ व नॉर्थ) जीती!",
        team1Defeated: "💀 टीम 1 (साउथ व नॉर्थ) हारी!",
        team2Won: "🎉 टीम 2 (ईस्ट व वेस्ट) जीती!",
        team2Defeated: "💀 टीम 2 (ईस्ट व वेस्ट) हारी!",
        yourTeamWon: "🎉 आपकी टीम जीत गई!",
        yourTeamDefeated: "💀 आपकी टीम हार गई!",
        opponentTeamWon: "🏆 विरोधी टीम जीत गई!",
        opponentTeamDefeated: "💀 विरोधी टीम हार गई!",
        viewTacticalAnalysis: "🧠 AI सामरिक विश्लेषण देखें",
        hideTacticalAnalysis: "🧠 AI सामरिक विश्लेषण छिपाएं",
        gamePtsWon: "गेम पॉइंट मिला!",
        gamePtsPenalty: "गेम पॉइंट पेनल्टी!",
        pts: "अंक",
        diffLabel: "AI कठिनाई (Difficulty)",
        diffEasy: "सरल",
        diffMedium: "मध्यम",
        diffHard: "कठिन",
        diffDescEasy: "सरल: विरोधी AI की कोई चालबाज़ी नहीं। आसान मैच।",
        diffDescMedium: "मध्यम: संतुलित AI रणनीति और मध्यम चुनौती।",
        diffDescHard: "कठिन: ग्रैंडमास्टर AI, पत्तों की गिनती और आक्रामक रणनीति।",
        suits: { '♠': '♠ हुकुम', '♥': '♥ पान', '♣': '♣ चिड़ी', '♦': '♦ ईंट' },
        dirs: { SOUTH: 'दक्षिण (S)', NORTH: 'उत्तर (N)', EAST: 'पूर्व (E)', WEST: 'पश्चिम (W)' }
    }
};

function setLanguage(lang) {
    currentLang = lang;
    try { localStorage.setItem('twentyEight_lang', lang); } catch(e) {}
    applyLanguage();
    if (typeof ui !== 'undefined' && ui) {
        ui.updatePlayerNames();
        ui.renderStaticBoard();
    }
}

const SUIT_FULL_NAMES = {
    '♠': { en: '♠ Spades', hi: '♠ हुकुम' },
    '♥': { en: '♥ Hearts', hi: '♥ पान' },
    '♦': { en: '♦ Diamonds', hi: '♦ ईंट' },
    '♣': { en: '♣ Clubs', hi: '♣ चिड़ी' }
};

function toggleLanguage() {
    setLanguage(currentLang === 'en' ? 'hi' : 'en');
}

function applyLanguage() {
    updateOrientationUI();
    const t = I18N[currentLang];
    const el = (id) => document.getElementById(id);
    if (el('start-logo-title')) el('start-logo-title').innerText = t.appName;
    if (el('net-ip-subtitle')) el('net-ip-subtitle').innerText = t.subtitle;
    if (el('cfg-nick-label')) el('cfg-nick-label').innerText = t.nicknameLabel;
    if (el('cfg-room-label')) el('cfg-room-label').innerText = t.roomCodeLabel;
    if (el('menu-online-title')) el('menu-online-title').innerText = t.onlineMultiplayer;
    if (el('btn-host-title')) el('btn-host-title').innerText = t.createRoom;
    if (el('btn-host-sub')) el('btn-host-sub').innerText = t.createRoomSub;
    if (el('btn-join-title')) el('btn-join-title').innerText = t.joinRoom;
    if (el('btn-join-sub')) el('btn-join-sub').innerText = t.joinRoomSub;
    if (el('menu-offline-title')) el('menu-offline-title').innerText = t.offlinePractice;
    if (el('btn-ai-title')) el('btn-ai-title').innerText = t.singlePlayer;
    if (el('btn-ai-sub')) el('btn-ai-sub').innerText = t.singlePlayerSub;
    if (el('btn-start-match')) el('btn-start-match').innerText = t.startMatch;
    if (el('btn-view-invite')) el('btn-view-invite').innerText = t.inviteBtn;
    if (el('btn-reset-lobby')) el('btn-reset-lobby').innerText = t.resetLobby;
    if (el('lang-toggle-btn')) el('lang-toggle-btn').innerText = t.langBtn;
    if (el('log-modal-title')) el('log-modal-title').innerText = t.logTitle;
    if (el('log-btn-text')) el('log-btn-text').innerText = t.logBtn;
    if (el('lang-pill-en')) el('lang-pill-en').className = `lang-pill ${currentLang === 'en' ? 'active' : ''}`;
    if (el('lang-pill-hi')) el('lang-pill-hi').className = `lang-pill ${currentLang === 'hi' ? 'active' : ''}`;
    if (el('reveal-btn')) el('reveal-btn').innerText = t.revealTrump;
    if (el('pair-btn')) el('pair-btn').innerText = t.declarePair;
    if (el('reshuffle-btn')) el('reshuffle-btn').innerText = t.reshuffleZeroPts;
    if (el('modal-reshuffle-btn')) el('modal-reshuffle-btn').innerText = t.reshuffleZeroPts;
    if (el('trump-modal-title')) el('trump-modal-title').innerText = t.selectTrump;
    if (el('trump-modal-sub')) el('trump-modal-sub').innerText = t.selectTrumpSub;
    if (el('pair-badge')) el('pair-badge').innerText = t.pairDeclared;
    if (el('share-title')) el('share-title').innerText = t.inviteTitle;
    if (el('share-sub')) el('share-sub').innerText = t.inviteSub;
    if (el('copy-invite-btn')) el('copy-invite-btn').innerText = t.copyInvite;
    if (el('close-share-btn')) el('close-share-btn').innerText = t.close;
    if (el('next-round-btn')) el('next-round-btn').innerText = t.dealNextRound;
    if (el('cfg-diff-label')) el('cfg-diff-label').innerText = t.diffLabel;
    if (el('tracker-btn-text')) el('tracker-btn-text').innerText = currentLang === 'hi' ? 'ट्रैकर' : 'Tracker';
    if (el('tracker-drawer-title')) el('tracker-drawer-title').innerText = currentLang === 'hi' ? 'खेले गए व शेष पत्ते' : 'CARDS PLAYED & REMAINING';
    if (el('tracker-pts-label')) el('tracker-pts-label').innerText = currentLang === 'hi' ? 'शेष अंक' : 'POINTS REMAINING';
    if (el('diff-text-easy')) el('diff-text-easy').innerText = t.diffEasy;
    if (el('diff-text-medium')) el('diff-text-medium').innerText = t.diffMedium;
    if (el('diff-text-hard')) el('diff-text-hard').innerText = t.diffHard;
    updateDifficultyUI();
}


export {
    I18N,
    currentLang,
    setLanguage,
    toggleLanguage,
    applyLanguage
};
