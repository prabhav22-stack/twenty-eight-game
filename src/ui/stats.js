/**
 * stats.js - Career Stats & Elo Rating Engine
 * Tracks win/loss history, streaks, contract success rates, and Elo ranking titles.
 */
// ==================== CAREER STATS & ELO ENGINE ====================
function getCareerStats() {
    let defaultStats = {
        elo: 1200,
        gamesPlayed: 0,
        gamesWon: 0,
        contractsAttempted: 0,
        contractsMade: 0,
        highestBidWon: 0,
        totalTrickPoints: 0,
        currentStreak: 0,
        bestStreak: 0,
        pairsDeclared: 0
    };
    try {
        let saved = localStorage.getItem('twenty_eight_career_stats');
        if (saved) return Object.assign(defaultStats, JSON.parse(saved));
    } catch(e) {}
    return defaultStats;
}

function saveCareerStats(stats) {
    try {
        localStorage.setItem('twenty_eight_career_stats', JSON.stringify(stats));
    } catch(e) {}
}

function getEloRankTitle(elo) {
    if (elo < 1100) return 'Apprentice ♠';
    if (elo < 1300) return 'Club Challenger ♣';
    if (elo < 1500) return 'Diamond Tactician ♦';
    if (elo < 1700) return 'Heart Master ♥';
    return 'Grandmaster of 28 👑';
}

function recordMatchInCareer(isWin, humanBidder, bidWon, currentBid, trickPtsScored, diffLevel) {
    let s = getCareerStats();
    s.gamesPlayed++;
    if (isWin) {
        s.gamesWon++;
        s.currentStreak++;
        if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
    } else {
        s.currentStreak = 0;
    }

    if (humanBidder) {
        s.contractsAttempted++;
        if (bidWon) {
            s.contractsMade++;
            if (currentBid > s.highestBidWon) s.highestBidWon = currentBid;
        }
    }

    s.totalTrickPoints += trickPtsScored;

    // Dynamic Elo Rating update
    let kFactor = diffLevel === 'hard' ? 24 : (diffLevel === 'medium' ? 16 : 10);
    let eloDelta = isWin ? kFactor : -Math.round(kFactor * 0.75);
    s.elo = Math.max(800, s.elo + eloDelta);

    saveCareerStats(s);
}

function openStatsModal() {
    let s = getCareerStats();
    let modal = document.getElementById('stats-modal');
    if (!modal) return;
    
    document.getElementById('stats-elo-num').innerText = s.elo;
    document.getElementById('stats-rank-title').innerText = getEloRankTitle(s.elo);
    document.getElementById('stats-matches-won').innerText = `${s.gamesWon} / ${s.gamesPlayed}`;
    let winRate = s.gamesPlayed > 0 ? Math.round((s.gamesWon / s.gamesPlayed) * 100) : 0;
    document.getElementById('stats-win-rate').innerText = `Win Rate: ${winRate}%`;
    document.getElementById('stats-current-streak').innerText = `${s.currentStreak} 🔥`;
    document.getElementById('stats-best-streak').innerText = `Best: ${s.bestStreak}`;
    document.getElementById('stats-contracts-made').innerText = `${s.contractsMade} / ${s.contractsAttempted}`;
    let cRate = s.contractsAttempted > 0 ? Math.round((s.contractsMade / s.contractsAttempted) * 100) : 0;
    document.getElementById('stats-contracts-rate').innerText = `Success: ${cRate}%`;
    document.getElementById('stats-total-pts').innerText = s.totalTrickPoints;
    document.getElementById('stats-pairs-declared').innerText = `K-Q Pairs: ${s.pairsDeclared}`;
    
    modal.style.display = 'flex';
}

function closeStatsModal() {
    let modal = document.getElementById('stats-modal');
    if (modal) modal.style.display = 'none';
}



export {
    getCareerStats,
    saveCareerStats,
    getEloRankTitle,
    recordMatchInCareer,
    openStatsModal,
    closeStatsModal
};
