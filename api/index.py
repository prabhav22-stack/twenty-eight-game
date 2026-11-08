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

# ==================== DEDICATED BOT PERSONALITIES ====================
BOT_PERSONALITIES = {
    1: {  # East
        'name': 'East',
        'title': 'The Aggressive Striker',
        'icon': '⚔️',
        'archetype': 'AGGRESSIVE_STRIKER',
        'description': 'High-risk challenger. Strikes high in 3rd seat, forces out declarer trumps, and cashes honors fast.',
        'bid_aggression': 1.25,
        'min_hand_pts_bid': 3,
        'max_bid_ceiling': 21,
        'third_hand_aggression': 1.8,
        'smear_weight': 1.1,
        'duck_factor': 0.25,
        'trump_punish_factor': 2.0,
        'lead_style': 'ATTACK_HIGH'
    },
    2: {  # North (Partner)
        'name': 'North',
        'title': 'The Loyal Wingman',
        'icon': '🛡️',
        'archetype': 'LOYAL_WINGMAN',
        'description': 'Selfless cooperative grandmaster. Strictly defers to your bids, smears 10s onto your tricks, and returns your leads.',
        'bid_aggression': 0.85,
        'min_hand_pts_bid': 4,
        'max_bid_ceiling': 19,
        'respect_partner_bid': True,
        'third_hand_aggression': 1.2,
        'smear_weight': 3.4,         # Highest priority: gifts 10s and Aces to South
        'duck_factor': 0.8,
        'trump_punish_factor': 0.4,
        'return_partner_suit': 2.6,   # Religiously returns South's successful leads
        'extract_opp_trumps': True,   # Bleeds opponent trumps when South is declarer
        'lead_style': 'SUPPORT_SOUTH'
    },
    3: {  # West
        'name': 'West',
        'title': 'The Cold Saboteur',
        'icon': '♟️',
        'archetype': 'COLD_SABOTEUR',
        'description': 'Calculating trapper. Feigns weakness with 2nd-hand-low ducking, passes to trap declarer, and ambushes 10s with late trump cuts.',
        'bid_aggression': 0.9,
        'min_hand_pts_bid': 5,
        'max_bid_ceiling': 20,
        'second_hand_low': True,      # Classic bridge defense: ducks low on 2nd seat
        'ambush_trump_cut': True,     # Saves trumps specifically for South's 10s and Aces
        'smear_weight': 1.4,
        'duck_factor': 2.4,           # Prefers ducking low to preserve control
        'trump_punish_factor': 1.5,
        'lead_style': 'PASSIVE_EXIT'  # Exits with neutral cards to force South to lead
    }
}

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

def call_groq(messages, timeout=1.8, preferred_model=None):
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
    models = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant", "qwen/qwen3.8-27b"]
    if preferred_model:
        if preferred_model in models:
            models.remove(preferred_model)
        models.insert(0, preferred_model)

    for model_name in models:
        payload = {
            "model": model_name,
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
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
    Personality-driven imperfect-information 28 bidding engine:
    - East (Seat 1, Aggressive Striker): High risk-tolerance, aggressively challenges South up to 21.
    - North (Seat 2, Loyal Wingman): Respects South, defers to South's contract, defends if South passes.
    - West (Seat 3, Cold Saboteur): Disciplined and cold, passes to trap South into overbidding.
    """
    bot = BOT_PERSONALITIES.get(player_idx, {
        'name': SEAT_NAMES[player_idx],
        'title': 'Player',
        'icon': '👤',
        'bid_aggression': 1.0,
        'max_bid_ceiling': 20
    })

    partner_idx = (player_idx + 2) % 4
    min_required = 16 if current_bid < 16 else current_bid + 1
    is_enemy = (player_idx in [1, 3])

    # 1. Partner Respect Rule
    # North (Loyal Wingman) strictly defers to South (human)!
    if highest_bidder == partner_idx:
        # If North has massive power (e.g. 2 Jacks and 6+ pts) at opening bid 16, North can support-raise to 17
        total_pts = sum(CARD_VALUES.get(c['rank'], 0) for c in hand)
        j_count = sum(1 for c in hand if c['rank'] == 'J')
        if player_idx == 2 and total_pts >= 6 and j_count >= 2 and current_bid == 16:
            return {'bid': 17, 'personality': bot}
        return {'bid': 'Pass', 'personality': bot}

    # 2. Forced dealer bid rule (if 3 players passed, dealer must bid 16)
    if pass_count == 3 and current_bid < 16:
        return {'bid': 16, 'personality': bot}

    # 3. Easy Mode: No AI involvement in enemy bots
    if difficulty == 'easy' and is_enemy:
        return {'bid': 'Pass', 'personality': bot}

    # Count points and card combinations
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

    # Baseline mathematical strength
    bid_strength = 14.0 + (total_pts * 1.0)
    if len(jacks) == 1: bid_strength += 1.5
    elif len(jacks) >= 2: bid_strength += 3.5

    for s in jacks:
        if s in nines: bid_strength += 2.5
        if s in aces: bid_strength += 1.0

    for s in nines:
        if s not in jacks and suit_counts[s] >= 2:
            bid_strength += 1.0

    if max_suit_count == 3: bid_strength += 2.0
    elif max_suit_count == 4: bid_strength += 4.0

    voids = sum(1 for s in SUITS if suit_counts[s] == 0)
    bid_strength += voids * 0.8

    # Apply Distinctive Bot Personalities
    if player_idx == 1:
        # East (The Aggressive Striker): +2.0 boost, pushes bids up to 21
        bid_strength += 2.0
        max_ceiling = bot.get('max_bid_ceiling', 21)
    elif player_idx == 3:
        # West (The Cold Saboteur): Disciplined, avoids overbids, traps South
        bid_strength -= 0.6
        max_ceiling = bot.get('max_bid_ceiling', 20)
        # If South already bid 18+ and West doesn't hold monster strength, West passes to trap!
        if current_bid >= 18 and total_pts < 6:
            return {'bid': 'Pass', 'personality': bot}
    elif player_idx == 2:
        # North (The Loyal Wingman): Supportive, protects South
        max_ceiling = bot.get('max_bid_ceiling', 19)
        if highest_bidder == 0:
            return {'bid': 'Pass', 'personality': bot}
    else:
        max_ceiling = 24

    max_willing_bid = min(max_ceiling, int(bid_strength))

    # Medium difficulty ceiling
    if difficulty == 'medium':
        max_willing_bid = min(19, max_willing_bid)
        if total_pts < 4 and len(jacks) == 0:
            return {'bid': 'Pass', 'personality': bot}

    if max_willing_bid >= min_required and min_required <= max_ceiling:
        return {'bid': min_required, 'personality': bot}

    return {'bid': 'Pass', 'personality': bot}

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

# ==================== ISMCTS ENGINE (INFORMATION SET MONTE CARLO) ====================
def run_ismcts_rollout(valid_indices, hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, unplayed, void_suits, num_simulations=35):
    """
    Information Set Monte Carlo Tree Search Rollouts for Imperfect Information 28.
    Simulates plausible hidden hands consistent with opponents' public void constraints
    to calculate expected point outcome for each candidate card.
    Zero hidden card peeking - pure Bayesian determinization rollouts.
    """
    if len(valid_indices) <= 1:
        return valid_indices[0] if valid_indices else 0

    partner_idx = (player_idx + 2) % 4
    move_scores = {idx: 0.0 for idx in valid_indices}

    # Determine which seats still need to play in the current trick
    played_seats = [tc['player'] for tc in trick_cards]
    remaining_seats = []
    curr = (trick_cards[-1]['player'] + 1) % 4 if trick_cards else player_idx
    while len(played_seats) + len(remaining_seats) < 4:
        if curr != player_idx:
            remaining_seats.append(curr)
        curr = (curr + 1) % 4

    for _ in range(num_simulations):
        deck_sample = list(unplayed)
        random.shuffle(deck_sample)

        for move_idx in valid_indices:
            my_card = hand[move_idx]
            sim_trick = list(trick_cards) + [{'player': player_idx, 'card': my_card}]
            temp_lead = lead_suit or my_card['suit']
            cur_deck = list(deck_sample)

            for seat in remaining_seats:
                seat_voids = void_suits.get(str(seat), {})
                # Legal cards for this seat
                legal = [c for c in cur_deck if not seat_voids.get(c['suit'], False)]
                matches = [c for c in legal if c['suit'] == temp_lead]
                if matches:
                    chosen = max(matches, key=lambda c: c['power'])
                elif legal:
                    trumps = [c for c in legal if trump_revealed and trump_suit and c['suit'] == trump_suit]
                    if trumps:
                        chosen = min(trumps, key=lambda c: c['power'])
                    else:
                        chosen = min(legal, key=lambda c: (c['value'], c['power']))
                else:
                    chosen = {'suit': temp_lead, 'rank': '7', 'value': 0, 'power': 1}

                if chosen in cur_deck:
                    cur_deck.remove(chosen)
                sim_trick.append({'player': seat, 'card': chosen})

            # Calculate trick winner
            best_play = sim_trick[0]
            pts = sum(tc['card']['value'] for tc in sim_trick)
            for play in sim_trick[1:]:
                c = play['card']
                w = best_play['card']
                c_trump = (trump_revealed and trump_suit and c['suit'] == trump_suit)
                w_trump = (trump_revealed and trump_suit and w['suit'] == trump_suit)
                if c_trump and not w_trump: best_play = play
                elif c_trump and w_trump:
                    if c['power'] > w['power']: best_play = play
                elif not c_trump and not w_trump:
                    if c['suit'] == temp_lead and (w['suit'] != temp_lead or c['power'] > w['power']):
                        best_play = play

            is_team_win = (best_play['player'] in [player_idx, partner_idx])
            delta = pts if is_team_win else -pts
            if is_team_win and my_card['value'] > 0:
                delta += 0.5 # Reward for successfully cashing point cards
            move_scores[move_idx] += delta

    return max(valid_indices, key=lambda i: move_scores[i])

# ==================== GRANDMASTER CARD PLAY ENGINE ====================
def evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits, difficulty='medium'):
    """
    Personality-driven Imperfect Information 28 Card Play Engine:
    - East (Seat 1, Aggressive Striker): Attacks 3rd-hand-high, bleeds declarer trumps, cashes masters fast.
    - North (Seat 2, Loyal Wingman): 3.4x smear priority onto South, returns South's suits, clears trumps for declarer South.
    - West (Seat 3, Cold Saboteur): Second-hand-low ducking, ambushes South's 10s and Aces with late trump cuts.
    """
    bot = BOT_PERSONALITIES.get(player_idx, {
        'name': SEAT_NAMES[player_idx],
        'title': 'Player',
        'icon': '👤',
        'archetype': 'BALANCED',
        'smear_weight': 1.0,
        'duck_factor': 1.0
    })

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
        return {'card_index': valid_indices[0], 'reveal_trump': False, 'personality': bot}

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
        multiplier = bot.get('smear_weight', 1.0)
        base = 0
        if c['rank'] == '10': base = 100 * multiplier # Unprotected 10 is ideal smear
        elif c['rank'] == 'A': base = 85 * multiplier
        elif c['rank'] == '9': base = 70 * multiplier
        elif c['rank'] == 'J': base = 60 * multiplier
        return base - c['power']

    # ==================== CASE 1: LEADING THE TRICK ====================
    if seat_in_trick == 0:
        # NORTH (Loyal Wingman) PERSONALITY: Returns South's lead or clears trumps for declarer South
        if player_idx == 2:
            # 1. If South is declarer and trump is revealed, lead trumps to draw out East & West's trumps!
            if trump_revealed and trump_suit and any(c['suit'] == trump_suit for c in hand):
                trumps_in_hand = [i for i in valid_indices if hand[i]['suit'] == trump_suit]
                if trumps_in_hand:
                    trumps_in_hand.sort(key=lambda i: hand[i]['power'])
                    return {'card_index': trumps_in_hand[0], 'reveal_trump': False, 'personality': bot}

            # 2. Return South's successful suit: look at past tricks where South led
            if played_history:
                for ph in played_history:
                    if ph.get('suit') and any(hand[i]['suit'] == ph['suit'] for i in valid_indices):
                        matching = [i for i in valid_indices if hand[i]['suit'] == ph['suit']]
                        if matching:
                            matching.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': matching[0], 'reveal_trump': False, 'personality': bot}

        # WEST (Cold Saboteur) PERSONALITY: Passive low exit lead (7s, 8s) to force South to lead away from honors
        elif player_idx == 3:
            zeros = [i for i in valid_indices if hand[i]['value'] == 0 and (trump_suit is None or hand[i]['suit'] != trump_suit)]
            if zeros:
                zeros.sort(key=lambda i: hand[i]['power'])
                return {'card_index': zeros[0], 'reveal_trump': False, 'personality': bot}

        # EAST (Aggressive Striker) PERSONALITY: Attacks with high cards & side-suit masters
        masters = [i for i in valid_indices if is_master_card(hand[i], unplayed)]
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
            safe_masters.sort(key=lambda i: (
                1 if (trump_suit and hand[i]['suit'] == trump_suit) else 2,
                hand[i]['value'],
                hand[i]['power']
            ), reverse=True)
            return {'card_index': safe_masters[0], 'reveal_trump': False, 'personality': bot}

        for s in SUITS:
            j_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == 'J'), None)
            nine_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == '9'), None)
            if j_idx is not None and nine_idx is not None:
                return {'card_index': j_idx, 'reveal_trump': False, 'personality': bot}

        best_lead = run_ismcts_rollout(valid_indices, hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, unplayed, void_suits)
        return {'card_index': best_lead, 'reveal_trump': False, 'personality': bot}

    # ==================== CASE 2: PARTNER IS WINNING ====================
    elif partner_is_winning:
        is_last_seat = (seat_in_trick == 3)
        partner_has_master = is_master_card(winning_card, unplayed)
        partner_guaranteed = is_last_seat or partner_has_master
        has_lead = any(c['suit'] == lead_suit for c in hand)

        # NORTH (Loyal Wingman) HIGHEST PRIORITY SMEAR: Gifts 10s and Aces directly to South!
        if partner_guaranteed or (player_idx == 2 and winning_card['rank'] in ['J', '9']):
            valid_indices.sort(key=lambda i: smear_value(i), reverse=True)
            return {'card_index': valid_indices[0], 'reveal_trump': False, 'personality': bot}
        else:
            if has_lead:
                master_leads = [i for i in valid_indices if is_master_card(hand[i], unplayed)]
                if master_leads and trick_points >= 1:
                    return {'card_index': master_leads[0], 'reveal_trump': False, 'personality': bot}
                valid_indices.sort(key=lambda i: hand[i]['power'])
                return {'card_index': valid_indices[0], 'reveal_trump': False, 'personality': bot}
            else:
                valid_indices.sort(key=lambda i: discard_cost(i))
                return {'card_index': valid_indices[0], 'reveal_trump': False, 'personality': bot}

    # ==================== CASE 3: OPPONENT IS WINNING ====================
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)

        if has_lead:
            winning_indices = [i for i in valid_indices if hand[i]['power'] > winning_card['power']]
            
            # WEST (Cold Saboteur) PERSONALITY: Second Hand Low! Ducks low on 2nd seat to let East attack in 3rd seat
            if player_idx == 3 and seat_in_trick == 1:
                zeros = [i for i in valid_indices if hand[i]['value'] == 0]
                if zeros:
                    zeros.sort(key=lambda i: hand[i]['power'])
                    return {'card_index': zeros[0], 'reveal_trump': False, 'personality': bot}

            # EAST (Aggressive Striker) PERSONALITY: Third Hand High! Hits hard in 3rd seat
            if player_idx == 1 and seat_in_trick == 2 and winning_indices:
                winning_indices.sort(key=lambda i: hand[i]['power'], reverse=True)
                return {'card_index': winning_indices[0], 'reveal_trump': False, 'personality': bot}

            if winning_indices:
                if seat_in_trick == 3:
                    winning_indices.sort(key=lambda i: hand[i]['power'])
                    return {'card_index': winning_indices[0], 'reveal_trump': False, 'personality': bot}
                else:
                    if trick_points >= 2 or winning_card['rank'] in ['J', '9']:
                        winning_indices.sort(key=lambda i: hand[i]['power'], reverse=True)
                        return {'card_index': winning_indices[0], 'reveal_trump': False, 'personality': bot}
                    else:
                        winning_indices.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': winning_indices[0], 'reveal_trump': False, 'personality': bot}
            else:
                valid_indices.sort(key=lambda i: (hand[i]['value'], hand[i]['power']))
                return {'card_index': valid_indices[0], 'reveal_trump': False, 'personality': bot}
        else:
            # Void in lead suit
            if (trump_revealed or reveal_trump) and trump_suit:
                trumps = [i for i in valid_indices if hand[i]['suit'] == trump_suit]
                if trumps:
                    if winning_card['suit'] == trump_suit:
                        overtrumps = [i for i in trumps if hand[i]['power'] > winning_card['power']]
                        if overtrumps and (trick_points >= 2 or winning_card['value'] >= 2):
                            overtrumps.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': overtrumps[0], 'reveal_trump': reveal_trump, 'personality': bot}
                        else:
                            non_trumps = [i for i in valid_indices if hand[i]['suit'] != trump_suit]
                            if non_trumps:
                                non_trumps.sort(key=lambda i: discard_cost(i))
                                return {'card_index': non_trumps[0], 'reveal_trump': False, 'personality': bot}
                            else:
                                trumps.sort(key=lambda i: hand[i]['power'])
                                return {'card_index': trumps[0], 'reveal_trump': reveal_trump, 'personality': bot}
                    else:
                        # WEST (Cold Saboteur): Ambush Trump Cut! Only cuts if pot has juicy points (>= 2 pts or Ace/10)
                        if player_idx == 3:
                            if trick_points >= 2 or winning_card['value'] >= 1:
                                trumps.sort(key=lambda i: hand[i]['power'])
                                return {'card_index': trumps[0], 'reveal_trump': reveal_trump, 'personality': bot}
                            else:
                                non_trumps = [i for i in valid_indices if hand[i]['suit'] != trump_suit]
                                if non_trumps:
                                    non_trumps.sort(key=lambda i: discard_cost(i))
                                    return {'card_index': non_trumps[0], 'reveal_trump': False, 'personality': bot}
                        else:
                            # Standard cut
                            if trick_points >= 1 or winning_card['value'] >= 1:
                                trumps.sort(key=lambda i: hand[i]['power'])
                                return {'card_index': trumps[0], 'reveal_trump': reveal_trump, 'personality': bot}

            if len(valid_indices) > 1:
                best_sluff = run_ismcts_rollout(valid_indices, hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, unplayed, void_suits)
                return {'card_index': best_sluff, 'reveal_trump': reveal_trump if not trump_revealed else False, 'personality': bot}
            valid_indices.sort(key=lambda i: discard_cost(i))
            return {'card_index': valid_indices[0], 'reveal_trump': reveal_trump if not trump_revealed else False, 'personality': bot}

# ==================== POST-ROUND COACH RECAP ====================
SUITS_MAP_EN = {'♥': 'Hearts', '♦': 'Diamonds', '♣': 'Clubs', '♠': 'Spades'}
SUITS_MAP_HI = {'♥': 'पान (Hearts)', '♦': 'ईंट (Diamonds)', '♣': 'चिड़ी (Clubs)', '♠': 'हुकुम (Spades)'}

def generate_round_recap(bidding_winner, contract, bidding_team, t1_pts, t2_pts, success, trump_suit, pair_declared, language='en', tricks=None, trump_reveal_event=None, custom_names=None, telemetry=None):
    """
    Generates deeply analytical, event-grounded AI Grandmaster post-match coaching using Groq LLM
    and client-pre-computed telemetry (blunders, contract pace delta, double-dummy turning points, and bidding audit).
    Outputs a structured Tactical Report Card JSON payload.
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

    # Parse telemetry elements
    telemetry = telemetry or {}
    blunders = telemetry.get('blunders', [])
    turning_point = telemetry.get('turning_point', {})
    bidding_audit = telemetry.get('bidding_audit', {})
    pace_graph = telemetry.get('pace_graph', [])
    partner_synergy = telemetry.get('partner_synergy', {})
    bot_locker_room = telemetry.get('bot_locker_room', {})

    # Extract turning point trick
    tp_trick_num = turning_point.get('trickNumber') or turning_point.get('trickNum')
    if not tp_trick_num:
        if tricks and len(tricks) > 0:
            max_t = max(tricks, key=lambda t: t.get('points', 0) if isinstance(t, dict) else 0)
            tp_trick_num = max_t.get('trickNum', 4) if isinstance(max_t, dict) else 4
        else:
            tp_trick_num = 4

    tp_drop = turning_point.get('winProbDrop') or turning_point.get('paceDrop') or "-28%"
    tp_card_played = turning_point.get('cardPlayed') or turning_point.get('southCard') or ""
    if tp_card_played == "Card":
        tp_card_played = ""
    tp_optimal_card = turning_point.get('optimalCard') or ""
    if tp_optimal_card == "Safe Exit":
        tp_optimal_card = ""
    tp_explanation = turning_point.get('explanation') or turning_point.get('reason') or ""

    # Calculate overall grade based on outcome and blunders
    blunder_count = len(blunders)
    if success:
        if diff >= 4 and blunder_count == 0: grade = "A+"
        elif diff >= 2 and blunder_count <= 1: grade = "A"
        elif blunder_count <= 1: grade = "B+"
        else: grade = "B"
    else:
        if abs_diff <= 1 and blunder_count == 0: grade = "B"
        elif abs_diff <= 2 and blunder_count <= 1: grade = "B-"
        elif blunder_count <= 2: grade = "C+"
        elif abs_diff >= 5 or blunder_count >= 3: grade = "D"
        else: grade = "C"

    # Default speaker and taunt for locker room
    if success:
        default_speaker = "Wingman (North)"
        default_taunt = (
            f"शानदार तालमेल! हुकुम {suit_hi} का सटीक उपयोग करके अनुबंध पूरा किया।"
            if language == 'hi' else
            f"Outstanding partnership play! Controlling {suit_en} sealed the {contract}-point contract."
        )
    else:
        default_speaker = "Saboteur (West)"
        default_taunt = (
            f"ट्रिक {tp_trick_num} पर आपकी चाल ने मैच का पासा पलट दिया।"
            if language == 'hi' else
            f"Your move in Trick {tp_trick_num} handed us the momentum—breaking {contract} was easy."
        )

    # Telemetry blunders summary for the prompt
    blunder_lines = []
    for b in blunders:
        if isinstance(b, dict):
            tag = b.get('tag', 'BLUNDER')
            t_num = b.get('trickNum', '?')
            msg = b.get('details') or b.get('message') or f"{tag} on Trick {t_num}"
            blunder_lines.append(f"  * [{tag}] {msg}")
        elif isinstance(b, str):
            blunder_lines.append(f"  * {b}")
    blunders_text = "\n".join(blunder_lines) if blunder_lines else "  * None: Flawless card discipline with zero detectable blunders."

    # First 4 cards bidding details
    deal1_cards = bidding_audit.get('deal1_cards', [])
    deal1_str = ", ".join(deal1_cards) if deal1_cards else "Standard deal"
    deal2_cards = bidding_audit.get('deal2_cards', [])
    deal2_str = ", ".join(deal2_cards) if deal2_cards else "Standard deal"
    b_rating = bidding_audit.get('rating', 'Optimal' if success else 'Aggressive')
    b_ev = bidding_audit.get('ev', 16)
    human_bid_val = bidding_audit.get('human_bid', contract)

    # Call Groq Cloud LLM for grandmaster commentary
    is_human_declarer = (bidding_winner == 0)
    b_summary_base = bidding_audit.get('summary', '')
    synergy_note_base = partner_synergy.get('note', '')

    system_prompt = (
        "You are an elite Twenty-Eight (28) card game grandmaster coach.\n"
        "Deliver an insightful, razor-sharp tactical post-match analysis strictly grounded in the telemetry provided.\n\n"
        "CRITICAL COACHING RULES FOR TWENTY-EIGHT (28):\n"
        "1. STRICT TRUTH: Reference ONLY the exact cards and suits South actually held in Deal 1. If South held Spades and Hearts, NEVER mention Clubs or Diamonds. Do not hallucinate cards!\n"
        "2. ROLE ACCURACY: If South did not win the bid, South was the DEFENDER. NEVER say South bid 16 or selected trump when South was defending!\n"
        "3. TRICK ISOLATION: In turningPointTrick.explanation, discuss ONLY the specified inflection trick. DO NOT combine or mention other trick numbers.\n"
        "4. LEGAL PLAYS ONLY: The optimalCard is pre-computed as a strictly legal play for that trick. Do not suggest other cards.\n"
        "5. Respect 28 card hierarchy: strictly J (3pts) > 9 (2pts) > A (1pt) > 10 (1pt) > K (0) > Q (0) > 8 (0) > 7 (0).\n"
        "6. Return ONLY valid JSON format matching the schema exactly.\n\n"
        "OUTPUT JSON SCHEMA (Do not copy example cards; use the exact match telemetry):\n"
        "{\n"
        '  "overallGrade": "<A+|A|B+|B|B-|C+|C|D>",\n'
        '  "biddingVerdict": {\n'
        '    "rating": "<rating>",\n'
        '    "summary": "<one sentence evaluating South deal 1 cards and pass/bid choice>"\n'
        '  },\n'
        '  "turningPointTrick": {\n'
        '    "trickNumber": <number>,\n'
        '    "winProbDrop": "<percentage>",\n'
        '    "cardPlayed": "<exact_card>",\n'
        '    "optimalCard": "<exact_card>",\n'
        '    "explanation": "<one or two sentences explaining strictly this trick and why cardPlayed caused a drop vs optimalCard>"\n'
        '  },\n'
        '  "partnerSynergy": {\n'
        '    "score": <number>,\n'
        '    "note": "<grounded note on partnership coordination between South and North>"\n'
        '  }\n'
        "}"
    )
    if language == 'hi':
        system_prompt += (
            "\n- LANGUAGE REQUIREMENT: Write summary, explanation, note, and taunt in authentic Hindi (Devanagari script), "
            "as spoken by a seasoned Indian 28 grandmaster."
        )

    role_desc = "South was the DECLARER / CONTRACTOR" if is_human_declarer else f"South was DEFENDER against {winner_name}'s {contract}-pt contract"
    user_prompt = (
        f"Match Context & Pre-Computed Telemetry:\n"
        f"- Player Role: {role_desc}\n"
        f"- Contract Bid: {contract} pts by {winner_name} | Trump: {suit_en} ({trump_suit})\n"
        f"- Final Score: Team 1 (South & North) = {t1_pts}/28 pts | Team 2 (East & West) = {t2_pts}/28 pts\n"
        f"- Match Outcome: {'VICTORY (Contract Fulfilled)' if success else f'DEFEATED by {abs_diff} pts'}\n"
        f"- South's Deal 1 (First 4 cards): [{deal1_str}] | South Action: {'Bid ' + str(human_bid_val) if is_human_declarer else 'Passed'} | EV: {b_ev} | Rating: {b_rating}\n"
        f"- Ground-Truth Bidding Assessment: {b_summary_base}\n"
        f"- Critical Inflection Point: Trick {tp_trick_num} (Win Pace Drop: {tp_drop})\n"
        f"  * South Card Played: {tp_card_played}\n"
        f"  * Recommended Legal Card: {tp_optimal_card}\n"
        f"  * Tactical Context: {tp_explanation}\n"
        f"- Partner Synergy Baseline: {partner_synergy.get('score', 65)}% - {synergy_note_base}\n"
        f"Generate the exact structured JSON Tactical Report Card strictly adhering to these factual details."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    res = call_groq(messages, timeout=4.5, preferred_model="openai/gpt-oss-120b")
    if res and isinstance(res, dict) and 'biddingVerdict' in res and 'turningPointTrick' in res:
        res['verdict'] = verdict_hi if language == 'hi' else verdict_en
        res['recap'] = res.get('turningPointTrick', {}).get('explanation', '') or res.get('biddingVerdict', {}).get('summary', '')
        return res

    # Structured Grandmaster Fallback built purely on telemetry
    fallback_b_summary = (
        f"आपकी {human_bid_val} की बोली ({deal1_str}) सांख्यिकीय रूप से {b_rating.lower()} थी। हुकुम {suit_hi} का चुनाव रणनीतिक था।"
        if language == 'hi' else
        f"Your {human_bid_val} bid on [{deal1_str}] was mathematically {b_rating.lower()}, keeping trump control active."
    )
    fallback_tp_explanation = (
        f"ट्रिक {tp_trick_num} मैच का मुख्य मोड़ रहा जहाँ {tp_card_played or 'पत्ता'} खेलने से गति धीमी हो गई। {tp_optimal_card or 'सुरक्षित पत्ता'} खेलना अधिक प्रभावी रहता।"
        if language == 'hi' else
        f"Trick {tp_trick_num} was the decisive inflection point: playing {tp_card_played or 'your card'} swung momentum {tp_drop}. Playing {tp_optimal_card or 'an alternate legal card'} preserved high honors."
    )
    fallback_synergy_note = (
        "विंगमैन (नॉर्थ) के साथ तालमेल संतुलित रहा; अहम मौकों पर बड़े पत्तों का संरक्षण हुआ।"
        if language == 'hi' else
        "Wingman maintained discipline in defense, backing your leads on critical tricks."
    )

    return {
        "overallGrade": grade,
        "biddingVerdict": {
            "rating": b_rating,
            "summary": bidding_audit.get('summary') or fallback_b_summary
        },
        "turningPointTrick": {
            "trickNumber": tp_trick_num,
            "winProbDrop": tp_drop,
            "cardPlayed": tp_card_played,
            "optimalCard": tp_optimal_card,
            "explanation": tp_explanation or fallback_tp_explanation
        },
        "partnerSynergy": {
            "score": partner_synergy.get('score', 75 if success else 60),
            "note": partner_synergy.get('note') or fallback_synergy_note
        },
        "verdict": verdict_hi if language == 'hi' else verdict_en,
        "recap": fallback_tp_explanation
    }

# ==================== HYBRID "BRAIN + PERSONA" BOT BACKEND ====================

SUIT_CHAR_MAP = {'S': '♠', 'H': '♥', 'C': '♣', 'D': '♦', '♠': '♠', '♥': '♥', '♣': '♣', '♦': '♦'}
SEAT_MAP = {'SOUTH': 0, 'EAST': 1, 'NORTH': 2, 'WEST': 3, 0: 0, 1: 1, 2: 2, 3: 3}
SEAT_NAMES_LOOKUP = {0: 'SOUTH', 1: 'EAST', 2: 'NORTH', 3: 'WEST'}
BOT_ROLES = {
    1: {'name': 'Striker', 'role': 'Aggressive Opponent', 'seat': 'EAST'},
    2: {'name': 'Wingman', 'role': 'Loyal Partner', 'seat': 'NORTH'},
    3: {'name': 'Saboteur', 'role': 'Calculating Opponent', 'seat': 'WEST'}
}

def normalize_card_item(c):
    if not c:
        return None
    if isinstance(c, str):
        c = c.strip().upper()
        s_char = c[-1]
        r_str = c[:-1]
        suit = SUIT_CHAR_MAP.get(s_char, '♠')
        val = CARD_VALUES.get(r_str, 0)
        pwr = CARD_POWER.get(r_str, 0)
        return {'suit': suit, 'rank': r_str, 'value': val, 'power': pwr, 'raw': c}
    elif isinstance(c, dict):
        suit = SUIT_CHAR_MAP.get(c.get('suit', '♠'), c.get('suit', '♠'))
        rank = c.get('rank', '7')
        val = c.get('value', CARD_VALUES.get(rank, 0))
        pwr = c.get('power', CARD_POWER.get(rank, 0))
        return {'suit': suit, 'rank': rank, 'value': val, 'power': pwr, 'raw': f"{rank}{suit}"}
    return None

def generate_bot_table_talk(bot_name, bot_role, context_desc, language='en'):
    """Generates authentic, punchy in-game table talk on pivotal moments using Groq LLM or fast fallback."""
    key = get_groq_api_key()
    if key:
        system_prompt = (
            f"You are {bot_name} ({bot_role}), playing the competitive card game Twenty-Eight (28). "
            f"South is the human player. Give an authentic, human single-sentence reaction (under 10 words) matching your personality. "
            'Return JSON strictly in format: {"dialogue": "...", "emote": "..."}.'
        )
        user_prompt = f"Moment: {context_desc}. Language: {language}."
        try:
            res = call_groq([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ], timeout=1.4)
            if res and isinstance(res, dict) and 'dialogue' in res:
                return res.get('dialogue', ''), res.get('emote', 'thinking_face')
        except Exception:
            pass

    # Fast contextual fallback templates
    fallbacks = {
        'Striker': {
            'trump_drain': ("Bleeding your trumps out, South!", "fire"),
            'high_cut': ("That trick is mine!", "crossed_swords"),
            'lead_attack': ("Let's see what you've got.", "sunglasses"),
            'bid': ("Pushing the stakes up!", "moneybag"),
            'generic': ("Bring it on.", "fire")
        },
        'Wingman': {
            'smear': ("Feeding you the points, partner!", "handshake"),
            'trump_reveal': ("Time to bring out the secret weapon!", "shield"),
            'desperation': ("I've got your back on this one.", "muscle"),
            'bid': ("Backing you up all the way.", "thumbsup"),
            'generic': ("Solid play, partner.", "sparkles")
        },
        'Saboteur': {
            'ambush': ("Right into my trap...", "smirk"),
            'contract_break': ("Contract broken. Game over.", "checkered_flag"),
            'duck': ("Take the bait...", "face_with_monocle"),
            'trump_reveal': ("Did you really think that was safe?", "eyes"),
            'generic': ("Patience is a virtue.", "chess_pawn")
        }
    }
    role_dict = fallbacks.get(bot_name, fallbacks['Saboteur'])
    for k in role_dict:
        if k in context_desc.lower():
            return role_dict[k]
    return role_dict['generic']

def evaluate_bot_brain(data):
    """
    Hybrid "Brain + Persona" Bot Decision Engine.
    Executes:
    - Layer 1: Mathematical Brain (EV Bidding, 4-Seat Positional ISMCTS, Boss Promotion)
    - Layer 2: Human Timing Engine (Snap-plays for forced cards, Tanking on high entropy)
    - Layer 3: Persona & Table-Talk Engine (Groq LLM on pivotal moments)
    - Layer 4: Opponent Profiling (Adapts to South's overbidding and baiting)
    """
    seat_val = data.get('seat', data.get('player_idx', 3))
    player_idx = SEAT_MAP.get(seat_val if isinstance(seat_val, str) else seat_val, 3)
    personality_name = data.get('personality', 'Saboteur')
    if player_idx == 1: personality_name = 'Striker'
    elif player_idx == 2: personality_name = 'Wingman'
    elif player_idx == 3: personality_name = 'Saboteur'

    phase = data.get('phase', 'PLAYING').upper()
    raw_hand = data.get('botHand', data.get('hand', []))
    hand = [normalize_card_item(c) for c in raw_hand if normalize_card_item(c)]

    raw_trick = data.get('currentTrick', data.get('trick_cards', []))
    trick_cards = []
    for tc in raw_trick:
        if isinstance(tc, dict):
            c = normalize_card_item(tc.get('card', tc))
            s = tc.get('seat', tc.get('player', 0))
            p_seat = SEAT_MAP.get(s if isinstance(s, str) else s, 0)
            trick_cards.append({'seat': SEAT_NAMES_LOOKUP.get(p_seat, 'SOUTH'), 'player': p_seat, 'card': c})

    bid_state = data.get('bidState', {})
    contract_bid = int(bid_state.get('target', data.get('current_bid', 16)))
    highest_bidder_seat = bid_state.get('winner', data.get('highest_bidder', -1))
    highest_bidder = SEAT_MAP.get(highest_bidder_seat if isinstance(highest_bidder_seat, str) else highest_bidder_seat, -1)
    trump_revealed = bool(bid_state.get('trumpRevealed', data.get('trump_revealed', False)))
    trump_suit = bid_state.get('trumpSuit', data.get('trump_suit', None))
    if trump_suit:
        trump_suit = SUIT_CHAR_MAP.get(trump_suit, trump_suit)

    raw_history = data.get('playedCardsHistory', data.get('played_history', []))
    played_history = [normalize_card_item(c) for c in raw_history if normalize_card_item(c)]

    team_points = data.get('teamPoints', {})
    t1_pts = int(team_points.get('NS', data.get('t1_pts', 0)))
    t2_pts = int(team_points.get('EW', data.get('t2_pts', 0)))

    session_mem = data.get('sessionMemory', {})
    human_overbids = int(session_mem.get('humanOverbids', 0))
    human_baits_jacks = float(session_mem.get('humanBaitsJacks', 0.0))
    language = data.get('language', 'en')

    # ==================== PHASE: BIDDING ====================
    if phase == 'BIDDING':
        suit_counts = {'♥':0, '♦':0, '♣':0, '♠':0}
        suit_jacks = {'♥':0, '♦':0, '♣':0, '♠':0}
        suit_nines = {'♥':0, '♦':0, '♣':0, '♠':0}
        total_jacks = 0
        for c in hand:
            suit_counts[c['suit']] += 1
            if c['rank'] == 'J': suit_jacks[c['suit']] = 1; total_jacks += 1
            if c['rank'] == '9': suit_nines[c['suit']] = 1

        best_ev = -1
        best_suit = '♠'
        for s in SUITS:
            trump_len = suit_counts[s]
            has_tj = suit_jacks[s]
            has_t9 = suit_nines[s]
            side_j = total_jacks - has_tj
            side_a = len([c for c in hand if c['suit'] != s and c['rank'] == 'A'])
            ev = 12 + (trump_len * 1.8) + (has_tj * 3.5) + (has_t9 * 2.5) + (side_j * 2.0) + (side_a * 0.8)
            if all(cnt <= 1 for cnt in suit_counts.values()):
                ev -= 3.0
            if ev > best_ev:
                best_ev = ev
                best_suit = s

        partner_idx = (player_idx + 2) % 4
        is_partner_high = (highest_bidder == partner_idx)

        # Cross-Round Opponent Profiling: If South overbids frequently, opponents let South hang
        if human_overbids >= 2 and player_idx in [1, 3]:
            best_ev -= 1.5

        max_willing = round(best_ev)
        if player_idx == 1 and best_ev >= 18: max_willing += 1
        elif player_idx == 2: max_willing = min(22, max_willing)

        chosen_bid = 'Pass'
        if not is_partner_high and contract_bid < max_willing:
            chosen_bid = max(16, contract_bid + 1)

        win_prob = round(min(0.95, max(0.25, 0.45 + (best_ev - 16) * 0.05)), 2)

        # Human Timing & Table Talk
        is_contested = (isinstance(chosen_bid, int) and chosen_bid >= 18)
        pre_think_ms = random.randint(1800, 2600) if is_contested else (random.randint(550, 950) if chosen_bid == 'Pass' else random.randint(1100, 1600))
        
        dialogue = ""
        emote = "thinking_face"
        pass

        return {
            "chosenAction": { "type": "PLACE_BID", "bid": chosen_bid, "suit": best_suit },
            "winProbability": win_prob,
            "humanBehavior": {
                "preThinkDelayMs": pre_think_ms,
                "hoverFakeoutCard": None,
                "emote": emote,
                "tableTalk": dialogue,
                "highDecisionEntropy": False
            },
            "sessionMemory": session_mem
        }

    # ==================== PHASE: SET_TRUMP ====================
    elif phase == 'SET_TRUMP':
        suit_scores = {s: 0 for s in SUITS}
        suit_lengths = {s: 0 for s in SUITS}
        for c in hand:
            suit_scores[c['suit']] += c['power'] + (c['value'] * 2)
            suit_lengths[c['suit']] += 1

        avail = list(set(c['suit'] for c in hand))
        multi_suits = [s for s in avail if suit_lengths[s] >= 2]
        candidates = multi_suits if multi_suits else avail

        best_suit = candidates[0]
        best_sc = -1
        for s in candidates:
            sc = (suit_lengths[s] * 12) + suit_scores[s]
            if sc > best_sc:
                best_sc = sc
                best_suit = s

        pre_think_ms = random.randint(1900, 2600)
        dialogue, emote = "", ""

        return {
            "chosenAction": { "type": "SET_TRUMP", "suit": best_suit },
            "winProbability": 0.72,
            "humanBehavior": {
                "preThinkDelayMs": pre_think_ms,
                "hoverFakeoutCard": None,
                "emote": emote,
                "tableTalk": dialogue,
                "highDecisionEntropy": False
            },
            "sessionMemory": session_mem
        }

    # ==================== PHASE: PLAYING ====================
    lead_suit = trick_cards[0]['card']['suit'] if trick_cards else None
    seat_in_trick = len(trick_cards) # 0=Lead, 1=2nd, 2=3rd, 3=4th

    # Determine legal card indices
    if not trick_cards:
        # Leader: if secret trump bidder before reveal, cannot lead secret trump unless void in all other suits
        if not trump_revealed and player_idx == highest_bidder and trump_suit:
            non_trumps = [i for i, c in enumerate(hand) if c['suit'] != trump_suit]
            valid_indices = non_trumps if non_trumps else list(range(len(hand)))
        else:
            valid_indices = list(range(len(hand)))
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            valid_indices = [i for i, c in enumerate(hand) if c['suit'] == lead_suit]
        else:
            valid_indices = list(range(len(hand)))

    # Evaluate CardMemory Matrix: unplayed cards by suit
    unplayed_by_suit = {s: ['J', '9', 'A', '10', 'K', 'Q', '8', '7'] for s in SUITS}
    for c in played_history:
        if c['rank'] in unplayed_by_suit.get(c['suit'], []):
            unplayed_by_suit[c['suit']].remove(c['rank'])
    for tc in trick_cards:
        if tc['card']['rank'] in unplayed_by_suit.get(tc['card']['suit'], []):
            unplayed_by_suit[tc['card']['suit']].remove(tc['card']['rank'])

    def is_boss(card):
        rem = unplayed_by_suit.get(card['suit'], [])
        return len(rem) > 0 and rem[0] == card['rank']

    # Current trick winner
    current_winner_player = -1
    winning_card = None
    trick_points = sum(tc['card']['value'] for tc in trick_cards)
    for tc in trick_cards:
        c = tc['card']
        p = tc['player']
        if winning_card is None:
            current_winner_player, winning_card = p, c
        else:
            is_c_trump = trump_revealed and trump_suit and (c['suit'] == trump_suit)
            is_w_trump = trump_revealed and trump_suit and (winning_card['suit'] == trump_suit)
            if is_c_trump and not is_w_trump:
                current_winner_player, winning_card = p, c
            elif is_c_trump and is_w_trump and c['power'] > winning_card['power']:
                current_winner_player, winning_card = p, c
            elif not is_c_trump and not is_w_trump and c['suit'] == lead_suit and c['power'] > winning_card['power']:
                current_winner_player, winning_card = p, c

    partner_idx = (player_idx + 2) % 4
    is_partner_winning = (current_winner_player == partner_idx)

    my_team = 1 if player_idx in [0, 2] else 2
    defending_needed = (29 - contract_bid) - (t1_pts if my_team == 1 else t2_pts)

    # Tactical Anti-Reveal Logic
    reveal_trump = False
    if not trump_revealed and trick_cards and not any(c['suit'] == lead_suit for c in hand):
        # Void in lead suit
        is_partner_boss = winning_card and is_boss(winning_card)
        is_partner_honor = winning_card and winning_card['rank'] in ['J', '9']
        is_last_seat = (seat_in_trick == 3)

        if is_partner_winning and (is_partner_boss or is_partner_honor or is_last_seat):
            reveal_trump = False # Anti-Reveal: Slough points onto partner!
        elif trick_points == 0 and len(played_history) <= 8:
            reveal_trump = False # Zero-point junk trick: save secret trump!
        elif player_idx == 3 and defending_needed <= 3 and trick_points >= 2:
            reveal_trump = True # Saboteur contract breaker threshold!
        elif trick_points >= 2 or (winning_card and winning_card['rank'] in ['J', '9', 'A']):
            reveal_trump = True

    # Score each legal move with 28 tactical heuristics
    move_scores = []
    for idx in valid_indices:
        card = hand[idx]
        score = 0

        # Positional awareness
        if seat_in_trick == 0:
            # Seat 1: Boss cashing vs Probing
            if is_boss(card):
                score += 35
            elif card['rank'] == '9':
                score -= 15 # Probing rule: don't lead unprotected 9!
            elif card['rank'] in ['7', '8']:
                score += 10 # Smoke out honors
            
            # Striker trump drain
            if personality_name == 'Striker' and trump_revealed and trump_suit and card['suit'] == trump_suit:
                if card['rank'] in ['J', '9']: score += 40
            
            # Saboteur baiting
            if personality_name == 'Saboteur' and not trump_revealed and card['rank'] in ['7', '8']:
                if any(c['suit'] == card['suit'] and c['rank'] == 'J' for c in hand):
                    score += 30

        elif seat_in_trick == 1:
            # Seat 2: Second Hand Low
            lead_c = trick_cards[0]['card']
            if lead_c['rank'] in ['7', '8']:
                boss_r = unplayed_by_suit.get(lead_c['suit'], ['J'])[0]
                if boss_r == 'J' and card['rank'] in ['9', 'A', '10']:
                    # Adaptive profiling: if South baits Jacks, Saboteur strictly ducks low!
                    penalty = 35 if (personality_name == 'Saboteur' and human_baits_jacks >= 0.5) else 25
                    score -= penalty
                elif card['rank'] in ['7', '8', 'Q']:
                    score += 18

        elif seat_in_trick == 2:
            # Seat 3: Third Hand High
            lead_c = trick_cards[0]['card']
            if trick_cards[0]['player'] == partner_idx and lead_c['rank'] in ['7', '8'] and card['power'] >= 6:
                score += 30

        elif seat_in_trick == 3:
            # Seat 4: Maximum Greed
            if is_partner_winning:
                # Fatten trick with points
                if card['value'] > 0:
                    score += card['value'] * 25
                    if card['rank'] != 'J': score += 10
            else:
                # Win as cheaply as possible
                beats_winner = False
                is_c_trump = (trump_revealed or reveal_trump) and trump_suit and (card['suit'] == trump_suit)
                is_w_trump = trump_revealed and trump_suit and (winning_card['suit'] == trump_suit)
                if is_c_trump and not is_w_trump: beats_winner = True
                elif is_c_trump and is_w_trump and card['power'] > winning_card['power']: beats_winner = True
                elif not is_c_trump and not is_w_trump and card['suit'] == lead_suit and card['power'] > winning_card['power']: beats_winner = True

                if beats_winner:
                    score += 40 - (card['power'] * 3) # Prefers lowest winner e.g. 10 over Jack!
                else:
                    score -= card['value'] * 20
                    if card['power'] <= 2: score += 15

        # Personality bonus
        if personality_name == 'Wingman' and is_partner_winning:
            score += card['value'] * 20
        elif personality_name == 'Saboteur' and defending_needed <= 3 and trick_points >= 2:
            score += 45

        # Royal pair protection in Phase 1
        if not trump_revealed and card['rank'] in ['K', 'Q']:
            has_mate = any(c['suit'] == card['suit'] and c['rank'] in ['K', 'Q'] and c['rank'] != card['rank'] for c in hand)
            if has_mate: score -= 30

        move_scores.append({'index': idx, 'card': card, 'score': score})

    move_scores.sort(key=lambda m: m['score'], reverse=True)
    best_move = move_scores[0]
    runner_up = move_scores[1] if len(move_scores) > 1 else None

    # Calculate Decision Entropy & Win Probability
    score_gap = (best_move['score'] - runner_up['score']) if runner_up else 999
    is_high_entropy = (len(valid_indices) > 1 and score_gap <= 8)
    win_prob = round(min(0.96, max(0.24, 0.52 + best_move['score'] * 0.015)), 2)

    # Human Timing Engine
    if len(valid_indices) == 1:
        pre_think_ms = random.randint(280, 420) # Forced Snap-Play!
        hover_fakeout = None
    elif is_high_entropy or reveal_trump or trick_points >= 4:
        pre_think_ms = random.randint(1850, 2800) # The Tank!
        hover_fakeout = runner_up['card']['raw'] if runner_up else None
    else:
        pre_think_ms = random.randint(750, 1350)
        hover_fakeout = None

    # Persona & Table Talk Engine on Pivotal Moments
    dialogue = ""
    emote = ""
    is_pivotal = reveal_trump or (trick_points >= 4) or (personality_name == 'Saboteur' and defending_needed <= 3) or is_high_entropy
    pass

    return {
        "chosenAction": {
            "type": "PLAY_CARD",
            "card": best_move['card']['raw'],
            "cardIndex": best_move['index'],
            "revealTrump": reveal_trump
        },
        "winProbability": win_prob,
        "humanBehavior": {
            "preThinkDelayMs": pre_think_ms,
            "hoverFakeoutCard": hover_fakeout,
            "emote": emote,
            "tableTalk": dialogue,
            "highDecisionEntropy": is_high_entropy
        },
        "sessionMemory": session_mem
    }



# ==================== MATHEMATICAL GROQ CO-PROCESSOR (/api/bot-math) ====================
def evaluate_bot_math(data):
    """
    Mathematical Bayesian Prior Generator & Dynamic Objective Weight Tuner (Groq LPUs).
    Feeds mathematical parameters directly into local JavaScript ISMCTS:
    1. Bayesian Prior Distribution over secret trump suits P(T = s | H_hard, B_Groq)
    2. Dynamic Utility Weight Vector w = [w_immediate, w_preserve, w_forceReveal, w_suitControl, w_partnerFeed]
    3. AlphaZero-style PUCT Prior Policy P_Groq(s, a) over legal cards
    """
    state = data.get('state', data)
    bid_target = int(state.get('bidTarget', state.get('current_bid', 16)))
    highest_bidder = state.get('highestBidder', state.get('highest_bidder', 'SOUTH'))
    trump_revealed = bool(state.get('trumpRevealed', state.get('trump_revealed', False)))
    trump_suit = state.get('trumpSuit', state.get('trump_suit', None))
    excluded_trumps = state.get('excludedTrumps', state.get('excluded_trumps', []))
    bot_hand = state.get('botHand', state.get('hand', []))
    legal_cards = state.get('legalCards', state.get('legal_cards', []))
    current_trick = state.get('currentTrick', state.get('trick_cards', []))
    team_points = state.get('teamPoints', state.get('team_points', {}))
    t1_pts = int(team_points.get('NS', state.get('t1_pts', 0)))
    t2_pts = int(team_points.get('EW', state.get('t2_pts', 0)))
    opp_profile = state.get('opponentProfile', state.get('opponent_profile', {}))

    norm_excluded = set(SUIT_CHAR_MAP.get(s, s) for s in excluded_trumps)

    groq_success = False
    trump_priors = {}
    move_priors = {}
    utility_weights = {}

    key = get_groq_api_key()
    if key:
        system_prompt = (
            "You are a mathematical game-theory co-processor for the South Asian card game Twenty-Eight (28). "
            "Card hierarchy: J(3pts) > 9(2pts) > A(1pt) > 10(1pt) > K(0) > Q(0) > 8(0) > 7(0). Total points = 28. "
            "Output ONLY a valid JSON object containing: "
            "1. 'trumpSuitPriors': probability distribution {'♠': float, '♥': float, '♦': float, '♣': float} summing to 1.0. "
            "2. 'movePriors': probability distribution over legalCards summing to 1.0. "
            "3. 'utilityWeights': {'immediatePts': 0..1, 'preserveHonors': 0..1, 'forceTrumpReveal': -1..1, 'suitControl': 0..1, 'partnerFeed': 0..1}."
        )
        user_prompt = json.dumps({
            "bidTarget": bid_target,
            "highestBidder": highest_bidder,
            "trumpRevealed": trump_revealed,
            "trumpSuit": trump_suit,
            "excludedTrumps": list(norm_excluded),
            "botHand": [c if isinstance(c, str) else f"{c.get('rank')}{c.get('suit')}" for c in bot_hand],
            "legalCards": [c if isinstance(c, str) else f"{c.get('rank')}{c.get('suit')}" for c in legal_cards],
            "trickLength": len(current_trick),
            "teamPoints": {"NS": t1_pts, "EW": t2_pts},
            "opponentProfile": opp_profile
        })
        try:
            res = call_groq([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ], timeout=1.4)
            if res and isinstance(res, dict):
                raw_tp = res.get('trumpSuitPriors', {})
                raw_mp = res.get('movePriors', {})
                raw_uw = res.get('utilityWeights', {})
                if raw_tp and raw_uw:
                    trump_priors = {SUIT_CHAR_MAP.get(k, k): float(v) for k, v in raw_tp.items()}
                    move_priors = {k: float(v) for k, v in raw_mp.items()}
                    utility_weights = {k: float(v) for k, v in raw_uw.items()}
                    groq_success = True
        except Exception:
            pass

    # Bayesian Posterior Normalization:
    # P(T = s | H_hard, B_Groq) = I_legal(s) * pi_Groq(s) / sum(I_legal(s') * pi_Groq(s'))
    if trump_revealed and trump_suit:
        norm_ts = SUIT_CHAR_MAP.get(trump_suit, trump_suit)
        trump_priors = {s: (1.0 if s == norm_ts else 0.0) for s in SUITS}
    else:
        if not groq_success or not trump_priors:
            trump_priors = {'♠': 0.25, '♥': 0.25, '♦': 0.25, '♣': 0.25}

        for s in norm_excluded:
            trump_priors[s] = 0.0

        total_p = sum(trump_priors.get(s, 0.0) for s in SUITS)
        if total_p > 0:
            trump_priors = {s: round(trump_priors.get(s, 0.0) / total_p, 3) for s in SUITS}
        else:
            avail = [s for s in SUITS if s not in norm_excluded]
            prob = 1.0 / len(avail) if avail else 0.25
            trump_priors = {s: (prob if s in avail else 0.0) for s in SUITS}

    # Dynamic Utility Weights w = [w_immediate, w_preserve, w_forceReveal, w_suitControl, w_partnerFeed]
    if not groq_success or not utility_weights:
        defending_needed = (29 - bid_target) - t2_pts
        is_panic = (defending_needed <= 4 or bid_target >= 19)
        is_stranglehold = (bid_target <= 15 and not is_panic)

        if is_panic:
            utility_weights = {
                "immediatePts": 0.95,
                "preserveHonors": 0.10,
                "forceTrumpReveal": 0.85,
                "suitControl": 0.70,
                "partnerFeed": 0.90
            }
        elif is_stranglehold:
            utility_weights = {
                "immediatePts": 0.35,
                "preserveHonors": 0.85,
                "forceTrumpReveal": -0.60,
                "suitControl": 0.80,
                "partnerFeed": 0.60
            }
        else:
            utility_weights = {
                "immediatePts": 0.70,
                "preserveHonors": 0.50,
                "forceTrumpReveal": 0.20,
                "suitControl": 0.65,
                "partnerFeed": 0.75
            }

    # AlphaZero-style PUCT Move Prior P_Groq(s, a):
    norm_legal = [c if isinstance(c, str) else f"{c.get('rank')}{c.get('suit')}" for c in legal_cards]
    if not groq_success or not move_priors:
        raw_priors = {}
        for c_str in norm_legal:
            card_obj = normalize_card_item(c_str)
            pwr = card_obj.get('power', 1) if card_obj else 1
            pts = card_obj.get('value', 0) if card_obj else 0
            raw_priors[c_str] = pwr + (pts * 2)
        total_mp = sum(raw_priors.values()) or 1
        move_priors = {c: round(raw_priors[c] / total_mp, 3) for c in norm_legal}
    else:
        filtered_mp = {c: float(move_priors.get(c, 0.1)) for c in norm_legal}
        total_mp = sum(filtered_mp.values()) or 1
        move_priors = {c: round(filtered_mp[c] / total_mp, 3) for c in norm_legal}

    return {
        "trumpSuitPriors": trump_priors,
        "movePriors": move_priors,
        "utilityWeights": utility_weights,
        "source": "groq_bayesian" if groq_success else "local_game_theoretic"
    }


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
            'endpoints': ['/api/bot-math', '/api/bot-brain', '/api/deal', '/api/bid', '/api/trump', '/api/play', '/api/recap', '/api/health']
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

        if any(k in route_str for k in ['bot-math', 'bot_math']):
            res = evaluate_bot_math(data)
            self._send_json(200, res)

        elif any(k in route_str for k in ['bot-brain', 'bot_brain', 'bot-turn', 'bot_turn']):
            res = evaluate_bot_brain(data)
            self._send_json(200, res)

        elif 'deal' in route_str:
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
            telemetry = data.get('telemetry', None)
            recap_res = generate_round_recap(
                bidding_winner, contract, bidding_team, t1_pts, t2_pts,
                success, trump_suit, pair_declared, language,
                tricks, trump_reveal_event, custom_names, telemetry
            )
            self._send_json(200, recap_res)

        else:
            self._send_json(404, {'error': f'Route not found: {raw_path}'})
