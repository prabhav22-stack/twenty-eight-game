/**
 * TacticalModal - AI Grandmaster Report Card & Telemetry Visualizer
 * Renders turning points, move regrets, partner synergy, and Expected Contract Equity (ECE).
 */
import { triggerHaptic } from './AudioHaptics.js';
import { I18N as defaultI18N, currentLang as defaultLang } from './i18n.js';

function toggleTacticalReportCard(engine = null, lang = null, i18nObj = null) {
    const box = document.getElementById('end-coach-box');
    const label = document.getElementById('trc-toggle-label');
    const arrow = document.getElementById('trc-toggle-arrow');
    if (!box) return;
    const isHidden = (box.style.display === 'none' || !box.style.display);
    const resolvedLang = lang || defaultLang || 'en';
    const dict = i18nObj || defaultI18N;
    const t = (dict && dict[resolvedLang]) || (dict && dict.en) || {};
    const isHi = (resolvedLang === 'hi');

        if (isHidden) {
            box.style.display = 'block';
            if (label) label.innerText = t.hideTacticalAnalysis || (isHi ? '🧠 AI सामरिक विश्लेषण छिपाएं' : '🧠 Hide AI Tactical Analysis');
            if (arrow) arrow.innerText = '▴';
            if (window.gsap) {
                gsap.fromTo(box, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
                gsap.fromTo('.trc-section', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.06, ease: 'power2.out' });
            }
            const modal = document.getElementById('end-modal');
            if (modal) {
                setTimeout(() => {
                    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 80);
            }
        } else {
            box.style.display = 'none';
            if (label) label.innerText = t.viewTacticalAnalysis || (isHi ? '🧠 AI सामरिक विश्लेषण देखें' : '🧠 View AI Tactical Analysis');
            if (arrow) arrow.innerText = '▾';
        }
    }

    function renderTacticalReportCard(engine, currentLang, I18N, res, telemetry) {
        const coachBox = document.getElementById('end-coach-box');
        if (!coachBox) return;

        let t = I18N[currentLang] || I18N.en;
        let isHi = (currentLang === 'hi');
        let titleEl = document.getElementById('end-coach-title');
        if (titleEl) titleEl.innerText = isHi ? 'AI सामरिक रिपोर्ट कार्ड' : 'AI Tactical Report Card';

        // Overall Grade Badge
        let grade = (res && res.overallGrade) ? res.overallGrade : (telemetry && telemetry.overallGrade ? telemetry.overallGrade : (engine.roundSuccess ? 'A-' : 'C+'));
        let gradeEl = document.getElementById('end-coach-grade-badge');
        if (gradeEl) {
            gradeEl.innerText = grade;
            gradeEl.className = 'trc-grade-badge';
            if (grade.startsWith('A')) gradeEl.classList.add('trc-grade-a');
            else if (grade.startsWith('B')) gradeEl.classList.add('trc-grade-b');
            else if (grade.startsWith('C')) gradeEl.classList.add('trc-grade-c');
            else gradeEl.classList.add('trc-grade-d');
        }

        // 1. Phase 1 Bidding Section
        let bData = (res && res.biddingVerdict && res.biddingVerdict.summary) 
            ? res.biddingVerdict 
            : (telemetry ? telemetry.bidding_audit : {});
        let bRatingEl = document.getElementById('trc-bidding-pill');
        let bRating = (bData && bData.rating) ? bData.rating : ((telemetry && telemetry.bidding_audit) ? telemetry.bidding_audit.rating : 'Optimal');
        if (bRatingEl) {
            bRatingEl.innerText = bRating;
            bRatingEl.className = 'trc-pill ' + (bRating.includes('Optimal') || bRating.includes('उत्कृष्ट') ? 'pill-optimal' : ((bRating.includes('Overbid') || bRating.includes('जोखिम')) ? 'pill-drop' : 'pill-warn'));
        }

        let d1Cards = (telemetry && telemetry.event_log && telemetry.event_log.bidding && telemetry.event_log.bidding.humanDeal1 && telemetry.event_log.bidding.humanDeal1.length) 
            ? telemetry.event_log.bidding.humanDeal1 
            : ((telemetry && telemetry.bidding_audit && telemetry.bidding_audit.deal1_cards && telemetry.bidding_audit.deal1_cards.length) 
                ? telemetry.bidding_audit.deal1_cards 
                : []);

        let bCardsEl = document.getElementById('trc-bidding-cards');
        if (bCardsEl) {
            bCardsEl.innerHTML = d1Cards.map(cStr => {
                let rank = cStr.slice(0, -1);
                let suit = cStr.slice(-1);
                let isRed = (suit === '♥' || suit === '♦');
                let cardPts = (rank === 'J' ? 3 : (rank === '9' ? 2 : ((rank === 'A' || rank === '10') ? 1 : 0)));
                return `<div class="trc-mini-card ${isRed ? 'red' : 'black'}" title="${cardPts} pt${cardPts !== 1 ? 's' : ''}">${rank}${suit} <span style="font-size:0.55rem; color:#94a3b8; margin-left:2px;">(${cardPts})</span></div>`;
            }).join('');
        }

        let bSumEl = document.getElementById('trc-bidding-summary');
        let bSummary = (bData && bData.summary) ? bData.summary : ((telemetry && telemetry.bidding_audit) ? telemetry.bidding_audit.summary : '');
        if (!bSummary || !bSummary.trim()) {
            bSummary = isHi 
                ? 'अनुशासित रक्षात्मक खेल: शुरुआती चालों में पत्तों को सुरक्षित रखकर टीम के लिए मजबूत आधार तैयार किया गया।'
                : 'Disciplined play: South maintained solid position and saved key honors for defensive counters.';
        }
        if (bSumEl) bSumEl.innerText = bSummary;

        // 2. Turning Point Section
        let tpData = (res && res.turningPointTrick && res.turningPointTrick.trickNumber) 
            ? res.turningPointTrick 
            : (telemetry ? telemetry.turning_point : {});
        let tpTrickNum = tpData.trickNumber || (telemetry && telemetry.turning_point ? telemetry.turning_point.trickNumber : 1);
        let tpTitleEl = document.getElementById('trc-tp-title');
        if (tpTitleEl) {
            tpTitleEl.innerText = isHi ? `⚡ निर्णायक मोड़: ट्रिक ${tpTrickNum}` : `⚡ INFLECTION POINT: TRICK ${tpTrickNum}`;
        }
        let tpDropEl = document.getElementById('trc-tp-drop-badge');
        if (tpDropEl) {
            let dropText = tpData.winProbDrop ? `${tpData.winProbDrop} Pace` : '0% Pace';
            tpDropEl.innerText = dropText;
        }

        let cardPlayedStr = tpData.cardPlayed || (telemetry && telemetry.turning_point ? telemetry.turning_point.cardPlayed : '') || '';
        let optimalCardStr = tpData.optimalCard || (telemetry && telemetry.turning_point ? telemetry.turning_point.optimalCard : '') || cardPlayedStr;

        let playedEl = document.getElementById('trc-played-card');
        if (playedEl) {
            if (cardPlayedStr) {
                let rank = cardPlayedStr.slice(0, -1);
                let suit = cardPlayedStr.slice(-1);
                let isRed = (suit === '♥' || suit === '♦');
                let pts = (rank === 'J' ? 3 : (rank === '9' ? 2 : ((rank === 'A' || rank === '10') ? 1 : 0)));
                playedEl.className = `trc-mini-card ${isRed ? 'red' : 'black'}`;
                playedEl.innerHTML = `${rank}${suit} <span style="font-size:0.55rem; color:#94a3b8; margin-left:2px;">(${pts}p)</span>`;
                playedEl.style.display = 'inline-flex';
            } else {
                playedEl.style.display = 'none';
            }
        }

        let optEl = document.getElementById('trc-optimal-card');
        if (optEl) {
            if (optimalCardStr) {
                let rank = optimalCardStr.slice(0, -1);
                let suit = optimalCardStr.slice(-1);
                let isRed = (suit === '♥' || suit === '♦');
                let pts = (rank === 'J' ? 3 : (rank === '9' ? 2 : ((rank === 'A' || rank === '10') ? 1 : 0)));
                optEl.className = `trc-mini-card ${isRed ? 'red' : 'black'}`;
                optEl.innerHTML = `${rank}${suit} <span style="font-size:0.55rem; color:#94a3b8; margin-left:2px;">(${pts}p)</span>`;
                optEl.style.display = 'inline-flex';
            } else {
                optEl.style.display = 'none';
            }
        }

        let tpExpEl = document.getElementById('trc-tp-explanation');
        let tpExplanation = (tpData && tpData.explanation && tpData.explanation.trim()) 
            ? tpData.explanation 
            : ((telemetry && telemetry.turning_point && telemetry.turning_point.explanation) ? telemetry.turning_point.explanation : '');
        if (!tpExplanation || !tpExplanation.trim()) {
            tpExplanation = isHi
                ? `ट्रिक ${tpTrickNum} इस राउंड की निर्णायक चाल रही जहाँ अंक और चाल का नियंत्रण तय हुआ।`
                : `Trick ${tpTrickNum} was the pivotal inflection trick of the round, deciding crucial trick points.`;
        }
        if (tpExpEl) tpExpEl.innerText = tpExplanation;

        // 3. Partner Synergy
        let synData = (res && res.partnerSynergy && res.partnerSynergy.note) 
            ? res.partnerSynergy 
            : (telemetry ? telemetry.partner_synergy : {});
        let synScoreEl = document.getElementById('trc-synergy-score');
        let synBarEl = document.getElementById('trc-synergy-bar');
        let synNoteEl = document.getElementById('trc-synergy-note');
        let score = (synData && synData.score !== undefined) ? synData.score : ((telemetry && telemetry.partner_synergy) ? telemetry.partner_synergy.score : 70);
        
        let synPill = score >= 80 ? (isHi ? '🌟 उत्कृष्ट तालमेल' : '🌟 High Synergy') : (score >= 60 ? (isHi ? '🤝 मजबूत साझेदारी' : '🤝 Solid Teamwork') : (isHi ? '⚠️ तालमेल की कमी' : '⚠️ Coordination Gap'));
        if (synScoreEl) synScoreEl.innerHTML = `${score}% <span style="font-size:0.58rem; color:#94a3b8; font-weight:600; margin-left:4px;">(${synPill})</span>`;
        if (synBarEl) synBarEl.style.width = `${score}%`;
        
        let synNote = (synData && synData.note) ? synData.note : ((telemetry && telemetry.partner_synergy) ? telemetry.partner_synergy.note : '');
        if (!synNote || !synNote.trim()) {
            synNote = isHi
                ? 'विंगमैन (नॉर्थ) के साथ तालमेल संतुलित रहा; अहम मौकों पर बड़े पत्तों का संरक्षण हुआ।'
                : 'Wingman maintained discipline in defense, backing your leads on critical tricks.';
        }
        if (synNoteEl) synNoteEl.innerText = synNote;
    }

// ===========================
// QoL UI IMPROVEMENTS JS
// ===========================

// --- Toast notifications ---
function showGameToast(msg, durationMs) {
    durationMs = durationMs || 2200;
    var container = document.getElementById('game-toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'game-toast';
    toast.innerHTML = msg;
    container.appendChild(toast);
    requestAnimationFrame(function() {
        requestAnimationFrame(function() { toast.classList.add('show'); });
    });
    setTimeout(function() {
        toast.classList.add('hiding');
        toast.classList.remove('show');
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, durationMs);
}

export {
    toggleTacticalReportCard,
    renderTacticalReportCard
};
