import json
import random
import os
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

# 28 Card Game Rules & Constants
SUITS = ['♥', '♦', '♣', '♠']
RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7']
CARD_VALUES = {'J': 3, '9': 2, 'A': 1, '10': 1, 'K': 0, 'Q': 0, '8': 0, '7': 0}
CARD_POWER = {'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 2, '7': 1}
SEAT_NAMES = ['South', 'East', 'North', 'West']

def get_groq_api_key():
    """Retrieves GROQ_API_KEY from environment or local .env.local file without committing secrets."""
    key = os.environ.get("GROQ_API_KEY")
    if key and key.strip():
        return key.strip()
    try:
        env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env.local')
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.startswith('GROQ_API_KEY='):
                        return line.strip().split('=', 1)[1].strip()
    except Exception:
        pass
    return None

def call_groq(messages, timeout=1.8):
    """Executes ultra-low latency inference on Groq Cloud with fast fallbacks."""
    key = get_groq_api_key()
    if not key:
        return None
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": "TwentyEightGame/1.0"
    }
    # Fast lightweight model pipeline
    for model_name in ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"]:
        payload = {
            "model": model_name,
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
            "messages": messages
        }
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                res = json.loads(response.read().decode('utf-8'))
                content = res['choices'][0]['message']['content']
                return json.loads(content)
        except Exception:
            continue
    return None

def create_full_deck():
    """Generates the standard 32-card deck for 28."""
    deck = []
    for suit in SUITS:
        for rank in RANKS:
            deck.append({
                'suit': suit,
                'rank': rank,
                'value': CARD_VALUES[rank],
                'power': CARD_POWER[rank],
                'isNew': False
            })
    random.shuffle(deck)
    return deck

def deal_cards():
    """Distributes 32 cards: 4 cards each for Phase 1, and 4 cards each for Phase 2."""
    deck = create_full_deck()
    phase1 = [[], [], [], []]
    for _ in range(4):
        for p in range(4):
            c = deck.pop()
            c['isNew'] = True
            phase1[p].append(c)

    phase2 = [[], [], [], []]
    for _ in range(4):
        for p in range(4):
            c = deck.pop()
            c['isNew'] = True
            phase2[p].append(c)

    for p in range(4):
        phase1[p].sort(key=lambda c: (SUITS.index(c['suit']), -c['power']))
        phase2[p].sort(key=lambda c: (SUITS.index(c['suit']), -c['power']))

    return {
        'phase1': phase1,
        'phase2': phase2,
        'status': 'success'
    }

# ==================== STRATEGIC BIDDING ENGINE ====================
def evaluate_bidding(hand, current_bid, highest_bidder, player_idx, pass_count, difficulty='medium'):
    """
    Expert imperfect-information 28 bidding engine.
    Supports 3 difficulty modes: 'easy', 'medium', 'hard'.
    - Easy: No AI involvement for enemy bots (seats 1 and 3). They pass.
    - Medium: Moderate AI involvement. Sensible bids up to 19, no risky overbids.
    - Hard: Full Grandmaster AI. Deep hand evaluation, void bonuses, Jack synergies up to 24.
    Partner (North, seat 2) always plays intelligently to assist human.
    """
    partner_idx = (player_idx + 2) % 4
    min_required = 16 if current_bid < 16 else current_bid + 1

    # Rule 1: Respect partner's bid! Partner holds contract -> ALWAYS pass!
    if highest_bidder == partner_idx:
        return {'bid': 'Pass'}

    # Rule 2: Forced dealer bid rule (if 3 players passed, dealer must bid 16)
    if pass_count == 3 and current_bid < 16:
        return {'bid': 16}

    # EASY MODE: No AI involvement in enemy bots (East & West, seats 1 and 3)
    is_enemy = (player_idx in [1, 3])
    if difficulty == 'easy' and is_enemy:
        return {'bid': 'Pass'}

    # Count points and analyze card combinations
    suit_counts = {s: 0 for s in SUITS}
    suit_points = {s: 0 for s in SUITS}
    jacks = []
    nines = []
    aces = []

    for c in hand:
        s = c['suit']
        r = c['rank']
        val = CARD_VALUES.get(r, 0)
        suit_counts[s] += 1
        suit_points[s] += val
        if r == 'J': jacks.append(s)
        elif r == '9': nines.append(s)
        elif r == 'A': aces.append(s)

    total_pts = sum(suit_points.values())
    max_suit_count = max(suit_counts.values())

    # MEDIUM DIFFICULTY: Moderate, sensible bidding
    if difficulty == 'medium':
        if total_pts < 4 and len(jacks) == 0:
            return {'bid': 'Pass'}
        max_willing = min(19, 15 + total_pts + (2 if len(jacks) > 0 else 0))
        if max_willing >= min_required and min_required <= 19:
            return {'bid': min_required}
        return {'bid': 'Pass'}

    # HARD DIFFICULTY: Grandmaster competitive bidding
    bid_strength = 14.0 + (total_pts * 1.0)

    if len(jacks) == 1: bid_strength += 1.5
    elif len(jacks) >= 2: bid_strength += 3.5

    # Jack + 9 combo in the same suit is extremely powerful in 28
    for s in jacks:
        if s in nines: bid_strength += 2.5
        if s in aces: bid_strength += 1.0

    for s in nines:
        if s not in jacks and suit_counts[s] >= 2:
            bid_strength += 1.0

    # Length bonus in primary suit
    if max_suit_count == 3: bid_strength += 2.0
    elif max_suit_count == 4: bid_strength += 4.0

    # Void bonus (ability to trump early in round)
    voids = sum(1 for s in SUITS if suit_counts[s] == 0)
    bid_strength += voids * 0.8

    max_willing_bid = min(24, int(bid_strength))

    # Competitive bidding against opponents
    if max_willing_bid >= min_required and min_required <= 24:
        return {'bid': min_required}

    return {'bid': 'Pass'}

def select_ai_trump(hand):
    """Selects optimal trump suit based strictly on the player's private hand."""
    suit_scores = {s: 0 for s in SUITS}
    suit_counts = {s: 0 for s in SUITS}

    for c in hand:
        s = c['suit']
        suit_counts[s] += 1
        suit_scores[s] += c.get('power', CARD_POWER.get(c['rank'], 0))
        suit_scores[s] += c.get('value', CARD_VALUES.get(c['rank'], 0)) * 3
        if c['rank'] == 'J': suit_scores[s] += 14
        elif c['rank'] == '9': suit_scores[s] += 8
        elif c['rank'] == 'A': suit_scores[s] += 4

    for s in SUITS:
        has_j = any(c['suit'] == s and c['rank'] == 'J' for c in hand)
        has_9 = any(c['suit'] == s and c['rank'] == '9' for c in hand)
        if has_j and has_9: suit_scores[s] += 10

    best_suit = max(SUITS, key=lambda s: (suit_counts[s] * 12 + suit_scores[s]))
    return {'trump_suit': best_suit}

# ==================== CARD COUNTING & PUBLIC STATE ====================
def get_unplayed_cards(played_history, trick_cards, my_hand):
    """
    Legitimate Human Card Counting:
    Calculates all cards remaining in the deck that are NOT in public history,
    NOT on the table, and NOT in my private hand.
    """
    seen = set()
    for c in played_history: seen.add((c['suit'], c['rank']))
    for tc in trick_cards: seen.add((tc['card']['suit'], tc['card']['rank']))
    for c in my_hand: seen.add((c['suit'], c['rank']))

    unplayed = []
    for s in SUITS:
        for r in RANKS:
            if (s, r) not in seen:
                unplayed.append({'suit': s, 'rank': r, 'value': CARD_VALUES[r], 'power': CARD_POWER[r]})
    return unplayed

def is_master_card(card, unplayed_cards):
    """Checks if a card is currently the highest unplayed card of its suit in the deck."""
    return not any(uc['suit'] == card['suit'] and uc['power'] > card['power'] for uc in unplayed_cards)

def get_trick_winner(trick_cards, lead_suit, trump_suit, trump_revealed):
    """Accurately calculates current winner and point total of trick."""
    if not trick_cards: return None, None, 0
    best_play = trick_cards[0]
    points = sum(tc['card']['value'] for tc in trick_cards)
    for play in trick_cards[1:]:
        c = play['card']
        w = best_play['card']
        is_c_trump = (trump_revealed and trump_suit and c['suit'] == trump_suit)
        is_w_trump = (trump_revealed and trump_suit and w['suit'] == trump_suit)
        if is_c_trump and not is_w_trump: best_play = play
        elif is_c_trump and is_w_trump:
            if c['power'] > w['power']: best_play = play
        elif not is_c_trump and not is_w_trump:
            if c['suit'] == lead_suit and (w['suit'] != lead_suit or c['power'] > w['power']):
                best_play = play
    return best_play['player'], best_play['card'], points

# ==================== GRANDMASTER CARD PLAY ENGINE ====================
def evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits, difficulty='medium'):
    """
    Imperfect Information 28 AI Card Play Engine with 3 Difficulty Modes:
    - Easy: No AI involvement in enemy bots (seats 1 and 3). They play lowest/random valid cards,
            never smear, never overtrump, never cut unless forced.
    - Medium: Balanced heuristic play without deep remaining-card calculation.
    - Hard: Grandmaster card counting (tracks all 32 cards), ruthless master card cashing,
            aggressive cross-smearing, cross-ruffing, and precision trump management.
    """
    partner_idx = (player_idx + 2) % 4
    opp1_idx = (player_idx + 1) % 4
    opp2_idx = (player_idx + 3) % 4
    is_enemy = (player_idx in [1, 3])

    # 1. Determine legal moves
    if not trick_cards:
        valid_indices = list(range(len(hand)))
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            valid_indices = [i for i, c in enumerate(hand) if c['suit'] == lead_suit]
        else:
            valid_indices = list(range(len(hand)))

    if len(valid_indices) == 1:
        return {'card_index': valid_indices[0], 'reveal_trump': False}

    # ==================== EASY MODE FOR ENEMY BOTS ====================
    # Zero AI involvement: naive play, never reveals trump, never smears, plays lowest power card
    if difficulty == 'easy' and is_enemy:
        if trick_cards and not any(hand[i]['suit'] == lead_suit for i in valid_indices):
            # Void in lead: discard non-trump trash if possible
            non_trumps = [i for i in valid_indices if trump_suit is None or hand[i]['suit'] != trump_suit]
            if non_trumps:
                non_trumps.sort(key=lambda i: hand[i]['power'])
                return {'card_index': non_trumps[0], 'reveal_trump': False}
        valid_indices.sort(key=lambda i: hand[i]['power'])
        return {'card_index': valid_indices[0], 'reveal_trump': False}

    # ==================== MEDIUM MODE ====================
    # Moderate AI involvement: basic following and trick winning without deep unplayed card counting
    if difficulty == 'medium':
        current_winner_player, winning_card, trick_points = get_trick_winner(trick_cards, lead_suit, trump_suit, trump_revealed)
        partner_is_winning = (current_winner_player == partner_idx)
        seat_in_trick = len(trick_cards)

        # Leading
        if seat_in_trick == 0:
            suit_counts = {s: sum(1 for c in hand if c['suit'] == s) for s in SUITS}
            # Lead highest card from longest suit
            valid_indices.sort(key=lambda i: (-suit_counts[hand[i]['suit']], -hand[i]['power']))
            return {'card_index': valid_indices[0], 'reveal_trump': False}

        # Partner is winning: duck cheaply
        if partner_is_winning:
            valid_indices.sort(key=lambda i: hand[i]['power'])
            return {'card_index': valid_indices[0], 'reveal_trump': False}

        # Opponent is winning
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            # Win if we have a higher card, otherwise play lowest
            winning_moves = [i for i in valid_indices if hand[i]['power'] > winning_card['power']]
            if winning_moves:
                winning_moves.sort(key=lambda i: hand[i]['power'])
                return {'card_index': winning_moves[0], 'reveal_trump': False}
            valid_indices.sort(key=lambda i: hand[i]['power'])
            return {'card_index': valid_indices[0], 'reveal_trump': False}
        else:
            # Void in lead
            if trump_revealed and trump_suit:
                trumps = [i for i in valid_indices if hand[i]['suit'] == trump_suit]
                if trumps and trick_points >= 1:
                    trumps.sort(key=lambda i: hand[i]['power'])
                    return {'card_index': trumps[0], 'reveal_trump': False}
            elif not trump_revealed and trick_points >= 2:
                # Ask to reveal trump if juicy trick
                return {'card_index': valid_indices[0], 'reveal_trump': True}

            # Discard lowest non-trump card
            non_trumps = [i for i in valid_indices if trump_suit is None or hand[i]['suit'] != trump_suit]
            if non_trumps:
                non_trumps.sort(key=lambda i: (hand[i]['value'], hand[i]['power']))
                return {'card_index': non_trumps[0], 'reveal_trump': False}
            valid_indices.sort(key=lambda i: hand[i]['power'])
            return {'card_index': valid_indices[0], 'reveal_trump': False}

    # ==================== HARD MODE: GRANDMASTER AI ====================
    # Full card counting, ruthless master card cashing, aggressive smearing, cross-ruffing
    unplayed = get_unplayed_cards(played_history, trick_cards, hand)
    current_winner_player, winning_card, trick_points = get_trick_winner(trick_cards, lead_suit, trump_suit, trump_revealed)
    partner_is_winning = (current_winner_player == partner_idx)
    seat_in_trick = len(trick_cards)

    # 3. Trump Revelation Strategy (only valid when void in lead suit and trump not yet revealed)
    reveal_trump = False
    if trick_cards and not trump_revealed and not partner_is_winning:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if not has_lead:
            high_value_target = (trick_points >= 2) or (winning_card and winning_card['rank'] in ['J', '9', 'A'])
            if high_value_target:
                if trump_suit:
                    # If trump_suit is known to this player (secret bidder), only reveal if player holds trumps
                    if any(c['suit'] == trump_suit for c in hand):
                        reveal_trump = True
                else:
                    # Non-bidder: asking for reveal gives a legitimate chance to trump-cut
                    reveal_trump = True

    # Card valuation helpers
    def discard_cost(i):
        c = hand[i]
        cost = c['value'] * 30 + c['power']
        if trump_suit and c['suit'] == trump_suit:
            cost += 150
            if c['rank'] in ['K', 'Q']: cost += 60 # Protect potential K-Q pair
        return cost

    def smear_value(i):
        c = hand[i]
        if trump_suit and c['suit'] == trump_suit:
            return -100 # Never smear trumps unless forced
        if c['rank'] == '10': return 100 # Unprotected 10 is ideal smear
        elif c['rank'] == 'A': return 80
        elif c['rank'] == '9': return 70
        elif c['rank'] == 'J': return 60
        return -c['power'] # Lower power 7/8 preferred over K/Q

    # ==================== CASE 1: LEADING THE TRICK ====================
    if seat_in_trick == 0:
        masters = [i for i in valid_indices if is_master_card(hand[i], unplayed)]

        # Check if opponents are void in the suit of these masters (to avoid getting trumped)
        safe_masters = []
        for i in masters:
            s = hand[i]['suit']
            opp_may_trump = False
            if trump_revealed and trump_suit and s != trump_suit:
                if void_suits.get(str(opp1_idx), {}).get(s) or void_suits.get(str(opp2_idx), {}).get(s):
                    opp_may_trump = True
            if not opp_may_trump:
                safe_masters.append(i)

        if safe_masters:
            # Cash side-suit masters first, then trump masters
            safe_masters.sort(key=lambda i: (
                1 if (trump_suit and hand[i]['suit'] == trump_suit) else 2,
                hand[i]['value'],
                hand[i]['power']
            ), reverse=True)
            return {'card_index': safe_masters[0], 'reveal_trump': False}

        # If holding Jack + 9 in a suit, leading the Jack forces out the Ace/10 and establishes the 9
        for s in SUITS:
            j_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == 'J'), None)
            nine_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == '9'), None)
            if j_idx is not None and nine_idx is not None:
                return {'card_index': j_idx, 'reveal_trump': False}

        # Cross-ruff: If partner is known void in a suit, lead that suit so partner can trump
        if trump_revealed and trump_suit:
            for s in SUITS:
                if s != trump_suit and void_suits.get(str(partner_idx), {}).get(s):
                    if not void_suits.get(str(opp1_idx), {}).get(s) and not void_suits.get(str(opp2_idx), {}).get(s):
                        suit_zeros = [i for i in valid_indices if hand[i]['suit'] == s and hand[i]['value'] == 0]
                        if suit_zeros:
                            suit_zeros.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': suit_zeros[0], 'reveal_trump': False}

        # Safe low lead: lead from longest suit, lowest value (7 or 8) to avoid leading unprotected 10s/Aces
        suit_counts = {s: sum(1 for c in hand if c['suit'] == s) for s in SUITS}
        valid_indices.sort(key=lambda i: (
            hand[i]['value'], # 0-pointers first
            -suit_counts[hand[i]['suit']], # longer suits
            hand[i]['power']
        ))
        return {'card_index': valid_indices[0], 'reveal_trump': False}

    # ==================== CASE 2: PARTNER IS WINNING ====================
    elif partner_is_winning:
        is_last_seat = (seat_in_trick == 3)
        partner_has_master = is_master_card(winning_card, unplayed)
        partner_guaranteed = is_last_seat or partner_has_master

        has_lead = any(c['suit'] == lead_suit for c in hand)

        if partner_guaranteed:
            # Partner's trick is guaranteed! SMEAR MAXIMUM POINTS!
            valid_indices.sort(key=lambda i: smear_value(i), reverse=True)
            return {'card_index': valid_indices[0], 'reveal_trump': False}
        else:
            # Partner currently winning, but opponents still have turns behind us
            if has_lead:
                # If we hold a master card and trick has points, overtake to lock the trick
                master_leads = [i for i in valid_indices if is_master_card(hand[i], unplayed)]
                if master_leads and trick_points >= 1:
                    return {'card_index': master_leads[0], 'reveal_trump': False}
                # Otherwise, duck with lowest power to not risk points
                valid_indices.sort(key=lambda i: hand[i]['power'])
                return {'card_index': valid_indices[0], 'reveal_trump': False}
            else:
                # Void in lead suit: discard cheapest trash
                valid_indices.sort(key=lambda i: discard_cost(i))
                return {'card_index': valid_indices[0], 'reveal_trump': False}

    # ==================== CASE 3: OPPONENT IS WINNING ====================
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)

        if has_lead:
            winning_indices = [i for i in valid_indices if hand[i]['power'] > winning_card['power']]
            if winning_indices:
                if seat_in_trick == 3:
                    # Last player: win as cheaply as possible
                    winning_indices.sort(key=lambda i: hand[i]['power'])
                    return {'card_index': winning_indices[0], 'reveal_trump': False}
                else:
                    # 2nd or 3rd player: if trick has points, win decisively; if 0 pts, win cheaply
                    if trick_points >= 2 or winning_card['rank'] in ['J', '9']:
                        winning_indices.sort(key=lambda i: hand[i]['power'], reverse=True)
                        return {'card_index': winning_indices[0], 'reveal_trump': False}
                    else:
                        winning_indices.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': winning_indices[0], 'reveal_trump': False}
            else:
                # Cannot win: play lowest power 0-pointer (duck)
                valid_indices.sort(key=lambda i: (hand[i]['value'], hand[i]['power']))
                return {'card_index': valid_indices[0], 'reveal_trump': False}
        else:
            # Void in lead suit
            if (trump_revealed or reveal_trump) and trump_suit:
                trumps = [i for i in valid_indices if hand[i]['suit'] == trump_suit]
                if trumps:
                    if winning_card['suit'] == trump_suit:
                        # Opponent played trump: can we overtrump?
                        overtrumps = [i for i in trumps if hand[i]['power'] > winning_card['power']]
                        if overtrumps and (trick_points >= 2 or winning_card['value'] >= 2):
                            overtrumps.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': overtrumps[0], 'reveal_trump': reveal_trump}
                        else:
                            # Cannot or should not overtrump: sluff trash off-suit
                            non_trumps = [i for i in valid_indices if hand[i]['suit'] != trump_suit]
                            if non_trumps:
                                non_trumps.sort(key=lambda i: discard_cost(i))
                                return {'card_index': non_trumps[0], 'reveal_trump': False}
                            else:
                                trumps.sort(key=lambda i: hand[i]['power'])
                                return {'card_index': trumps[0], 'reveal_trump': reveal_trump}
                    else:
                        # Opponent winning with non-trump: cut with lowest trump!
                        if trick_points >= 1 or winning_card['value'] >= 1:
                            trumps.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': trumps[0], 'reveal_trump': reveal_trump}

            # Sluff lowest cost trash card
            valid_indices.sort(key=lambda i: discard_cost(i))
            return {'card_index': valid_indices[0], 'reveal_trump': reveal_trump if not trump_revealed else False}

# ==================== POST-ROUND COACH RECAP ====================
SUITS_MAP_EN = {'♥': 'Hearts', '♦': 'Diamonds', '♣': 'Clubs', '♠': 'Spades'}
SUITS_MAP_HI = {'♥': 'पान (Hearts)', '♦': 'ईंट (Diamonds)', '♣': 'चिड़ी (Clubs)', '♠': 'हुकुम (Spades)'}

def generate_round_recap(bidding_winner, contract, bidding_team, t1_pts, t2_pts, success, trump_suit, pair_declared, language='en', tricks=None, trump_reveal_event=None, custom_names=None):
    """
    Generates deeply analytical, event-grounded AI Coach match analysis using Groq LLM.
    Analyzes actual match moments:
    - Verdict on game difficulty (easy blowout win, clutch nail-biter, or heavy collapse)
    - The decisive turning point (specific trick number, trump cut, honor steal, or smear)
    - Where the teams went wrong or right (tactical masterstroke vs costly mistake)
    """
    winner_name = SEAT_NAMES[bidding_winner] if bidding_winner in range(4) else f"Player {bidding_winner}"
    if custom_names and isinstance(custom_names, list) and bidding_winner < len(custom_names):
        c_name = str(custom_names[bidding_winner]).strip()
        if c_name and c_name not in ['SOUTH', 'EAST', 'NORTH', 'WEST']:
            winner_name = f"{winner_name} ({c_name})"

    declarer_team_en = "Team 1 (South & North)" if bidding_team == 1 else "Team 2 (East & West)"
    defending_team_en = "Team 2 (East & West)" if bidding_team == 1 else "Team 1 (South & North)"
    dec_pts = t1_pts if bidding_team == 1 else t2_pts
    def_pts = t2_pts if bidding_team == 1 else t1_pts
    diff = dec_pts - contract
    abs_diff = abs(diff)

    suit_en = SUITS_MAP_EN.get(trump_suit, trump_suit)
    suit_hi = SUITS_MAP_HI.get(trump_suit, trump_suit)

    # 1. Match Verdict Category & Difficulty
    if success:
        if diff >= 4:
            verdict_en = f"Dominant Blowout Win (+{diff} pts)"
            verdict_hi = f"एकतरफा शानदार जीत (+{diff} अंक)"
        elif diff == 0:
            verdict_en = "Clutch Nail-Biter (Decided on final wire)"
            verdict_hi = "बेहद रोमांचक कांटे की जीत (अंतिम पत्तों पर फैसला)"
        elif diff in [1, 2]:
            verdict_en = f"Hard-Fought Victory (+{diff} pt{'s' if diff > 1 else ''})"
            verdict_hi = f"कड़ा मुकाबला और संघर्षपूर्ण जीत (+{diff} अंक)"
        else:
            verdict_en = "Comfortable Win (+3 pts)"
            verdict_hi = "संतुलित और सुरक्षित जीत (+3 अंक)"
    else:
        if abs_diff >= 5:
            verdict_en = f"Heavy Defeat (-{abs_diff} pts)"
            verdict_hi = f"भारी शिकस्त (-{abs_diff} अंक)"
        elif abs_diff in [1, 2]:
            verdict_en = f"Heartbreaking Near-Miss (-{abs_diff} pt{'s' if abs_diff > 1 else ''})"
            verdict_hi = f"दिल तोड़ने वाली नजदीकी हार (-{abs_diff} अंक)"
        else:
            verdict_en = f"Contract Defeated (-{abs_diff} pts)"
            verdict_hi = f"अनुबंध असफल (-{abs_diff} अंक)"

    # 2. Extract key chronological moments from tricks
    trick_highlights = []
    max_trick = None
    reveal_trick_info = None

    if tricks and isinstance(tricks, list) and len(tricks) > 0:
        max_trick = max(tricks, key=lambda t: t.get('points', 0) if isinstance(t, dict) else 0)
        for t in tricks:
            if not isinstance(t, dict): continue
            t_num = t.get('trickNum', 0)
            w_seat = t.get('winningSeat', 'Someone')
            w_card = t.get('winningCard', '')
            pts = t.get('points', 0)
            honors = t.get('honors', [])
            has_reveal = t.get('trumpRevealedThisTrick')

            if has_reveal and not reveal_trick_info:
                reveal_trick_info = t

            if pts >= 2 or has_reveal or t_num in [1, 7, 8]:
                h_str = ""
                if honors:
                    h_cards = []
                    for h in honors:
                        if isinstance(h, dict):
                            h_cards.append(f"{h.get('rank', '')}{h.get('suit', '')} ({h.get('pts', 0)}p by {h.get('seat', '')})")
                        elif isinstance(h, str):
                            h_cards.append(h)
                    if h_cards:
                        h_str = f" [Key cards: {', '.join(h_cards)}]"
                rev_str = " (🚨 Trump Revealed!)" if has_reveal else ""
                trick_highlights.append(f"Trick {t_num}: Won by {w_seat} with {w_card} (+{pts} pts){rev_str}{h_str}")

    # 3. Turning point sentence derivation
    if reveal_trick_info:
        r_num = reveal_trick_info.get('trickNum')
        r_seat = reveal_trick_info.get('winningSeat')
        r_pts = reveal_trick_info.get('points', 0)
        tp_en = f"The critical turning point arrived in Trick {r_num} when trump was revealed and {r_seat} seized the trick (+{r_pts} pts)."
        tp_hi = f"मैच का निर्णायक मोड़ ट्रिक {r_num} में आया जब हुकुम खोला गया और {r_seat} ने चाल जीतकर (+{r_pts} अंक) पासा पलट दिया।"
    elif max_trick and max_trick.get('points', 0) >= 3:
        m_num = max_trick.get('trickNum')
        m_seat = max_trick.get('winningSeat')
        m_pts = max_trick.get('points')
        tp_en = f"The decisive momentum shift occurred in Trick {m_num}, where {m_seat} captured a massive {m_pts}-point pot."
        tp_hi = f"मुख्य बदलाव ट्रिक {m_num} में देखने को मिला, जहाँ {m_seat} ने {m_pts} अंकों की विशाल चाल अपने नाम की।"
    else:
        tp_en = f"The battle came down to the wire in the final tricks, where {winner_name}'s team sealed the outcome."
        tp_hi = f"मुकाबला अंतिम चालों तक बेहद कड़ा रहा, जहाँ निर्णायक बाज़ियों ने मैच का फैसला किया।"

    # 4. Strategic takeaway (where they went right or wrong)
    if success:
        strat_en = f"{declarer_team_en} controlled trumps with great discipline and cashed master honors at the perfect moments."
        strat_hi = f"घोषक टीम ने हुकुम का सटीक नियंत्रण रखा और बड़े पत्तों (Jacks & 9s) को सही समय पर खेलकर जीत सुनिश्चित की।"
    else:
        strat_en = f"{defending_team_en}'s rock-solid defense punished the declarer's overbidding, denying the key honors needed to reach {contract}."
        strat_hi = f"रक्षात्मक टीम ने अनुशासित खेल दिखाते हुए बड़े पत्तों को सुरक्षित रखा और {winner_name} की आक्रामक {contract} अंक की बोली को मात दी।"

    # Fallback complete recaps
    if language == 'hi':
        t1_hi = "टीम 1 (साउथ व नॉर्थ)"
        t2_hi = "टीम 2 (ईस्ट व वेस्ट)"
        dec_hi = t1_hi if bidding_team == 1 else t2_hi
        def_hi = t2_hi if bidding_team == 1 else t1_hi
        pair_hi = " (रॉयल K-Q जोड़ी घोषित)" if pair_declared else ""
        if success:
            fallback_recap = f"{dec_hi} ({winner_name}) ने {suit_hi} में {contract} अंक की बोली पर {verdict_hi.lower()} दर्ज की ({dec_pts} अंक बनाए){pair_hi}। {tp_hi} {strat_hi}"
        else:
            fallback_recap = f"{winner_name} की {suit_hi} में {contract} अंक की बोली {verdict_hi.lower()} साबित हुई, जहाँ टीम {abs_diff} अंक पीछे रह गई ({dec_pts} अंक बने){pair_hi}। {tp_hi} {strat_hi}"
        verdict = verdict_hi
    else:
        pair_en = " (Royal K-Q pair declared)" if pair_declared else ""
        if success:
            fallback_recap = f"{declarer_team_en} ({winner_name}) delivered a {verdict_en.lower()}, fulfilling the {contract}-point contract in {suit_en} with {dec_pts} points{pair_en}. {tp_en} {strat_en}"
        else:
            fallback_recap = f"{winner_name}'s {contract}-point bid in {suit_en} resulted in a {verdict_en.lower()}, falling {abs_diff} points short ({dec_pts} scored){pair_en}. {tp_en} {strat_en}"
        verdict = verdict_en

    # 5. Call Groq Cloud LLM for grandmaster commentary
    system_prompt = (
        "You are an elite, analytical 28 card game commentator.\n"
        "Deliver an insightful, high-level post-match analysis strictly grounded in the exact chronological game events provided.\n"
        "YOUR ANALYSIS MUST COVER:\n"
        "1. Verdict on Match Difficulty: State clearly whether this was an easy blowout win, a hard-fought battle, a clutch nail-biter, or a heavy collapse, citing the point margin.\n"
        "2. The Decisive Turning Point: Highlight the specific trick number and key card play that swung momentum (such as a high point capture, a timely trump reveal cut, or a critical honor drop).\n"
        "3. Tactical Key Factor: Explain precisely where the losing team went wrong (e.g. overbidding, dropping unprotected 10s, losing trump control) or what master play sealed the victory.\n"
        "STRICT CONSTRAINTS:\n"
        "- NEVER use the phrase 'South Asian 28 Card Game' or treat the game title as an entity.\n"
        "- Refer only to real table seats: South, North, East, West, Team 1 (South & North), and Team 2 (East & West).\n"
        "- Keep it punchy and engaging: exactly 2 to 3 sentences in total.\n"
        "- Respond in valid JSON format with keys 'verdict' and 'recap'."
    )
    if language == 'hi':
        system_prompt += (
            "\n- LANGUAGE REQUIREMENT: Write in authentic, fluent, professional Hindi (Devanagari script) "
            "as spoken by an expert Indian card game analyst. Avoid awkward mechanical translations."
        )

    highlights_text = "\n".join(f"  * {h}" for h in trick_highlights) if trick_highlights else "  * Tightly fought tricks across all rounds."

    user_prompt = (
        f"Match Context & Chronological Trick Events:\n"
        f"- Declarer: {winner_name} playing for {declarer_team_en}\n"
        f"- Defending Team: {defending_team_en}\n"
        f"- Contract Bid: {contract} points | Trump: {suit_en} ({trump_suit})\n"
        f"- Final Score: Declarer Team = {dec_pts}/28 pts | Defending Team = {def_pts}/28 pts\n"
        f"- Outcome: {'CONTRACT FULFILLED (Victory)' if success else f'CONTRACT DEFEATED (Defeated by {abs_diff} points)'}\n"
        f"- Royal Trump K-Q Pair: {'Declared (+4 points swing)' if pair_declared else 'Not declared'}\n"
        f"- Suggested Verdict Label: {verdict_en}\n"
        f"- Chronological Match Highlights:\n{highlights_text}\n"
        f"- Output Language: {'Hindi (Devanagari script)' if language == 'hi' else 'English'}\n"
        "Write a 2-3 sentence grounded, insightful match analysis in JSON format: {\"verdict\": \"...\", \"recap\": \"...\"}"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    res = call_groq(messages, timeout=3.0)
    if res and isinstance(res, dict) and 'recap' in res:
        recap_clean = str(res['recap']).strip(' "\'\n')
        v_clean = str(res.get('verdict', verdict)).strip(' "\'\n')
        if "South Asian 28" not in recap_clean and len(recap_clean) > 15:
            return {'verdict': v_clean or verdict, 'recap': recap_clean}

    return {'verdict': verdict, 'recap': fallback_recap}


class handler(BaseHTTPRequestHandler):
    """Vercel Serverless Function Handler"""

    def _send_json(self, status_code, payload):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        raw_path = self.headers.get('x-matched-path') or self.path or ''
        self._send_json(200, {
            'status': 'healthy',
            'service': '28-game-groq-ai-backend',
            'version': '2.3.0',
            'groq_active': bool(get_groq_api_key()),
            'received_path': raw_path,
            'endpoints': ['/api/deal', '/api/bid', '/api/trump', '/api/play', '/api/recap', '/api/health']
        })

    def do_POST(self):
        raw_path = self.headers.get('x-matched-path') or self.path or ''
        content_length = int(self.headers.get('Content-Length', 0))
        data = {}
        if content_length > 0:
            try:
                body_str = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body_str) if body_str else {}
            except Exception as e:
                self._send_json(400, {'error': f'Invalid JSON payload: {str(e)}'})
                return

        route_str = f"{raw_path} {data.get('action', '')}".lower()

        if 'deal' in route_str:
            res = deal_cards()
            self._send_json(200, res)

        elif 'bid' in route_str:
            hand = data.get('hand', [])
            current_bid = data.get('current_bid', 15)
            highest_bidder = data.get('highest_bidder', -1)
            player_idx = data.get('player_idx', 0)
            pass_count = data.get('pass_count', 0)
            difficulty = data.get('difficulty', 'medium')
            res = evaluate_bidding(hand, current_bid, highest_bidder, player_idx, pass_count, difficulty)
            self._send_json(200, res)

        elif 'trump' in route_str:
            hand = data.get('hand', [])
            res = select_ai_trump(hand)
            self._send_json(200, res)

        elif 'play' in route_str:
            hand = data.get('hand', [])
            trick_cards = data.get('trick_cards', [])
            lead_suit = data.get('lead_suit', None)
            trump_suit = data.get('trump_suit', None)
            trump_revealed = data.get('trump_revealed', False)
            player_idx = data.get('player_idx', 0)
            played_history = data.get('played_history', [])
            void_suits = data.get('void_suits', {})
            difficulty = data.get('difficulty', 'medium')
            res = evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits, difficulty)
            self._send_json(200, res)

        elif 'recap' in route_str:
            bidding_winner = data.get('bidding_winner', 0)
            contract = data.get('contract', 16)
            bidding_team = data.get('bidding_team', 1)
            t1_pts = data.get('t1_pts', 0)
            t2_pts = data.get('t2_pts', 0)
            success = data.get('success', True)
            trump_suit = data.get('trump_suit', '♥')
            pair_declared = data.get('pair_declared', False)
            language = data.get('language', 'en')
            tricks = data.get('tricks', [])
            trump_reveal_event = data.get('trump_reveal_event', None)
            custom_names = data.get('custom_names', None)
            recap_res = generate_round_recap(
                bidding_winner, contract, bidding_team, t1_pts, t2_pts,
                success, trump_suit, pair_declared, language,
                tricks, trump_reveal_event, custom_names
            )
            # Support both object format {'verdict': ..., 'recap': ...} and direct access
            self._send_json(200, recap_res)

        else:
            self._send_json(404, {'error': f'Route not found: {raw_path}'})
