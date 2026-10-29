import json
import random
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

# 28 Card Game Rules & Constants
SUITS = ['♥', '♦', '♣', '♠']
RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7']
CARD_VALUES = {'J': 3, '9': 2, 'A': 1, '10': 1, 'K': 0, 'Q': 0, '8': 0, '7': 0}
CARD_POWER = {'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 2, '7': 1}

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
    # Phase 1: 4 cards to each of the 4 players (South:0, East:1, North:2, West:3)
    phase1 = [[], [], [], []]
    for _ in range(4):
        for p in range(4):
            c = deck.pop()
            c['isNew'] = True
            phase1[p].append(c)

    # Phase 2: Remaining 4 cards to each player
    phase2 = [[], [], [], []]
    for _ in range(4):
        for p in range(4):
            c = deck.pop()
            c['isNew'] = True
            phase2[p].append(c)

    # Sort hands by suit and rank power
    for p in range(4):
        phase1[p].sort(key=lambda c: (SUITS.index(c['suit']), -c['power']))
        phase2[p].sort(key=lambda c: (SUITS.index(c['suit']), -c['power']))

    return {
        'phase1': phase1,
        'phase2': phase2,
        'status': 'success'
    }

def evaluate_bidding(hand, current_bid, highest_bidder, player_idx, pass_count=0):
    """
    Expert AI bidding logic based on standard 28 auction principles:
    - Evaluates 4-card Phase 1 hand.
    - True 28 card valuation: Jacks (3 pts, Power 8), Nines (2 pts, Power 7), Aces (1 pt), Tens (1 pt).
    - Honors count and distribution:
      * Jack + Nine in the same suit is an ironclad anchor (guarantees 2 tricks).
      * Jack alone in a long suit is high-value.
      * 3 or 4 cards of one suit provides dominant trump control.
      * Off-suit singletons / voids allow cutting with trump in early rounds.
    - Partnership awareness:
      * If partner holds highest bid, do NOT overbid partner unless holding overwhelming strength (>= 20).
      * Counter-bidding: If opponents hold contract, push up to legitimate value (17-18) to compete.
    - Forced dealer bid:
      * If 3 players pass before dealer, dealer must bid 16.
    """
    current_bid = int(current_bid) if current_bid is not None else 15
    min_required = max(16, current_bid + 1)
    
    partner_idx = (player_idx + 2) % 4
    partner_is_highest = (highest_bidder == partner_idx)

    # Suit analysis
    suit_counts = {s: 0 for s in SUITS}
    suit_points = {s: 0 for s in SUITS}
    suit_powers = {s: 0 for s in SUITS}
    jacks = []
    nines = []
    aces = []

    for c in hand:
        s = c['suit']
        r = c['rank']
        val = CARD_VALUES.get(r, 0)
        pwr = CARD_POWER.get(r, 0)
        suit_counts[s] += 1
        suit_points[s] += val
        suit_powers[s] += pwr
        if r == 'J': jacks.append(s)
        elif r == '9': nines.append(s)
        elif r == 'A': aces.append(s)

    total_pts = sum(suit_points.values())
    max_suit_count = max(suit_counts.values())

    # Calculate bidding power
    # Base valuation starts at 13
    bid_strength = 13.0
    bid_strength += total_pts * 1.5

    # Jack valuation: Jacks are the ultimate trump controllers
    if len(jacks) == 1:
        bid_strength += 2.5
    elif len(jacks) >= 2:
        bid_strength += 4.5

    # Jack + Nine in the same suit is the strongest 2-card holding in 28
    for s in jacks:
        if s in nines:
            bid_strength += 3.0
        if s in aces:
            bid_strength += 1.5

    # Nine without Jack in a 2+ card suit
    for s in nines:
        if s not in jacks and suit_counts[s] >= 2:
            bid_strength += 1.0

    # Length bonus in candidate trump suit
    if max_suit_count == 3:
        bid_strength += 2.5
    elif max_suit_count == 4:
        bid_strength += 4.5

    # Voids / singletons off-suit allow cutting and ruffing
    voids = sum(1 for s in SUITS if suit_counts[s] == 0)
    bid_strength += voids * 0.8

    max_willing_bid = int(bid_strength)

    # 1. Partner awareness: If partner holds the contract, ALWAYS PASS to support partner!
    # In 28, overbidding your partner only raises the target on your own team.
    if partner_is_highest:
        return {'bid': 'Pass'}

    # 2. Forced dealer bid rule
    if pass_count == 3 and current_bid < 16:
        return {'bid': 16}

    # 3. Competitive bidding against opponents
    if max_willing_bid >= min_required and min_required <= 24:
        return {'bid': min_required}

    return {'bid': 'Pass'}

def select_ai_trump(hand):
    """
    Selects optimal trump suit for AI:
    - Prioritizes suit length and top honors (Jack, Nine).
    - J + 9 combination gets highest weighting.
    - Avoids suits with only low spot cards (7, 8).
    """
    suit_scores = {s: 0 for s in SUITS}
    suit_counts = {s: 0 for s in SUITS}

    for c in hand:
        s = c['suit']
        suit_counts[s] += 1
        suit_scores[s] += c.get('power', CARD_POWER.get(c['rank'], 0))
        suit_scores[s] += c.get('value', CARD_VALUES.get(c['rank'], 0)) * 3
        if c['rank'] == 'J':
            suit_scores[s] += 14
        elif c['rank'] == '9':
            suit_scores[s] += 8
        elif c['rank'] == 'A':
            suit_scores[s] += 4

    # J + 9 synergy bonus
    for s in SUITS:
        has_j = any(c['suit'] == s and c['rank'] == 'J' for c in hand)
        has_9 = any(c['suit'] == s and c['rank'] == '9' for c in hand)
        if has_j and has_9:
            suit_scores[s] += 10

    best_suit = max(SUITS, key=lambda s: (suit_counts[s] * 12 + suit_scores[s]))
    return {'trump_suit': best_suit}

def is_master_card(card, played_history, current_trick):
    """
    Checks if a card is currently the highest unplayed card of its suit (invincible boss).
    Jack is always boss (power 8).
    For lower ranks, it is boss if all higher ranks in that suit have already been played.
    """
    if card['rank'] == 'J':
        return True
    higher_powers = [p for r, p in CARD_POWER.items() if p > card['power']]
    for p in higher_powers:
        rank_name = [r for r, pwr in CARD_POWER.items() if pwr == p][0]
        already_played = any(c['suit'] == card['suit'] and c['rank'] == rank_name for c in played_history)
        in_trick = any(tc['card']['suit'] == card['suit'] and tc['card']['rank'] == rank_name for tc in current_trick)
        if not already_played and not in_trick:
            return False
    return True

def get_trick_winner(trick_cards, lead_suit, trump_suit, trump_revealed):
    """Accurately calculates current winner and point total of trick."""
    if not trick_cards:
        return None, None, 0
    best_play = trick_cards[0]
    points = sum(tc['card']['value'] for tc in trick_cards)
    for play in trick_cards[1:]:
        c = play['card']
        w = best_play['card']
        is_c_trump = (trump_revealed and c['suit'] == trump_suit)
        is_w_trump = (trump_revealed and w['suit'] == trump_suit)
        if is_c_trump and not is_w_trump:
            best_play = play
        elif is_c_trump and is_w_trump:
            if c['power'] > w['power']: best_play = play
        elif not is_c_trump and not is_w_trump:
            if c['suit'] == lead_suit and (w['suit'] != lead_suit or c['power'] > w['power']):
                best_play = play
    return best_play['player'], best_play['card'], points

def evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits):
    """
    World-Class 28 AI Card Play Engine:
    - Card Memory & Boss Tracking: Tracks all played cards and identifies invincible master cards.
    - Dynamic Role Strategy:
      * Leader (1st seat): Plays safe masters, develops long suits, cross-ruffs with partner.
      * Second Hand (2nd seat): Second hand low, ducking low on worthless tricks, seizing points.
      * Third Hand (3rd seat): Third hand high, supporting partner's lead.
      * Fourth Hand (4th seat): Full information advantage, smearing points on partner, winning cheaply.
    - Intelligent Trump Reveal:
      * Only when void in lead suit and not leading.
      * Reveals trump to capture high-point tricks (2+ pts, J, 9, or Ace) from opponents.
      * Never reveals trump when partner is winning.
    - Smearing & Ducking:
      * Dumps Tens (1 pt) and Nines into partner's winning tricks.
      * Ducks with 7s/8s (0 pts) on opponents' tricks.
    - Royal Pair Protection:
      * Protects King and Queen of trump suit to declare Royal Pair (+4 points).
    """
    partner_idx = (player_idx + 2) % 4
    opp1_idx = (player_idx + 1) % 4
    opp2_idx = (player_idx + 3) % 4

    # 1. Determine valid legal plays
    if not trick_cards:
        valid_indices = list(range(len(hand)))
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            valid_indices = [i for i, c in enumerate(hand) if c['suit'] == lead_suit]
        else:
            valid_indices = list(range(len(hand)))

    current_winner_player, winning_card, trick_points = get_trick_winner(trick_cards, lead_suit, trump_suit, trump_revealed)
    partner_is_winning = (current_winner_player == partner_idx)
    seat_in_trick = len(trick_cards) # 0 = leader, 1 = 2nd hand, 2 = 3rd hand, 3 = 4th hand (last)

    # 2. Check if AI should reveal trump
    reveal_trump = False
    if trick_cards and not trump_revealed:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if not has_lead: # Must be void in lead suit
            has_trumps = any(c['suit'] == trump_suit for c in hand)
            if has_trumps and not partner_is_winning:
                # Opponent is winning. Is it worth cutting?
                high_value_target = (trick_points >= 2) or (winning_card and winning_card['rank'] in ['J', '9', 'A'])
                if high_value_target:
                    reveal_trump = True

    # Helper: Cost to dump a card (lower is better to discard/dump)
    def discard_cost(i):
        c = hand[i]
        cost = c['value'] * 25 + c['power']
        # Guard trump cards heavily
        if trump_suit and c['suit'] == trump_suit:
            cost += 120
            # Guard K and Q of trump for Pair declaration
            if c['rank'] in ['K', 'Q']:
                cost += 80
        return cost

    # Helper: Smear value (higher is better to feed into partner's winning trick)
    def smear_value(i):
        c = hand[i]
        # Tens (1 pt, low power 5) are prime smear candidates!
        # Aces (1 pt, power 6) and Nines (2 pts) are also great smears.
        if c['suit'] == trump_suit:
            return -100 # Don't smear trumps!
        if c['rank'] == '10':
            return 80
        elif c['rank'] == '9':
            return 70
        elif c['rank'] == 'A':
            return 60
        elif c['rank'] == 'J':
            return 50
        return -c['power'] # If dumping 0-value card, dump lowest power

    best_card_idx = valid_indices[0]

    # ==================== CASE 1: LEADING TRICK (SEAT 0) ====================
    if seat_in_trick == 0:
        # A. Find master cards (invincible bosses)
        master_indices = [i for i in valid_indices if is_master_card(hand[i], played_history, trick_cards)]
        
        # Filter safe masters (where opponents are not known to be void if trump is revealed)
        safe_masters = []
        for i in master_indices:
            s = hand[i]['suit']
            opp_void = False
            if trump_revealed and s != trump_suit:
                if void_suits.get(str(opp1_idx), {}).get(s) or void_suits.get(str(opp2_idx), {}).get(s):
                    opp_void = True
            if not opp_void:
                safe_masters.append(i)

        if safe_masters:
            # Play safe master with highest points first (Jack > Nine > Ace)
            safe_masters.sort(key=lambda i: (hand[i]['value'], hand[i]['power']), reverse=True)
            return {'card_index': safe_masters[0], 'reveal_trump': False}

        # B. Holding Jack + Nine of same suit: lead the Jack to draw opponent cards
        for s in SUITS:
            j_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == 'J'), None)
            nine_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == '9'), None)
            if j_idx is not None and nine_idx is not None:
                return {'card_index': j_idx, 'reveal_trump': False}

        # C. Partner cross-ruff: if partner is void in suit S, lead low card of suit S so partner can trump!
        if trump_revealed:
            for s in SUITS:
                if s != trump_suit and void_suits.get(str(partner_idx), {}).get(s):
                    if not void_suits.get(str(opp1_idx), {}).get(s) and not void_suits.get(str(opp2_idx), {}).get(s):
                        suit_cards = [i for i in valid_indices if hand[i]['suit'] == s and hand[i]['value'] == 0]
                        if suit_cards:
                            suit_cards.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': suit_cards[0], 'reveal_trump': False}

        # D. Safe exit: lead lowest non-point card of longest suit
        suit_counts = {s: sum(1 for c in hand if c['suit'] == s) for s in SUITS}
        valid_indices.sort(key=lambda i: (
            hand[i]['value'], # 0 points preferred
            -suit_counts[hand[i]['suit']], # longer suit preferred
            hand[i]['power'] # lower power preferred
        ))
        return {'card_index': valid_indices[0], 'reveal_trump': False}

    # ==================== CASE 2: PARTNER IS WINNING ====================
    elif partner_is_winning:
        # Check if partner's win is guaranteed
        is_last_seat = (seat_in_trick == 3)
        partner_has_boss = is_master_card(winning_card, played_history, trick_cards)
        partner_safe = is_last_seat or partner_has_boss

        has_lead = any(c['suit'] == lead_suit for c in hand)

        if partner_safe:
            # Partner is 100% winning! SMEAR maximum points!
            if has_lead:
                # Smear Tens (1 pt), Nines (2 pts), Aces (1 pt) into partner's trick
                valid_indices.sort(key=lambda i: smear_value(i), reverse=True)
                return {'card_index': valid_indices[0], 'reveal_trump': False}
            else:
                # Void in lead: discard point cards from weak suits or dump lowest garbage
                valid_indices.sort(key=lambda i: smear_value(i), reverse=True)
                return {'card_index': valid_indices[0], 'reveal_trump': False}
        else:
            # Partner is winning but opponent behind might beat partner!
            if has_lead:
                # If we hold the master Jack in this suit, seize the trick to protect partner!
                bosses = [i for i in valid_indices if is_master_card(hand[i], played_history, trick_cards)]
                if bosses and trick_points >= 1:
                    return {'card_index': bosses[0], 'reveal_trump': False}
                # Otherwise play low card to not waste points if opponent takes over
                valid_indices.sort(key=lambda i: hand[i]['power'])
                return {'card_index': valid_indices[0], 'reveal_trump': False}
            else:
                # Void: dump lowest useless card
                valid_indices.sort(key=lambda i: discard_cost(i))
                return {'card_index': valid_indices[0], 'reveal_trump': False}

    # ==================== CASE 3: OPPONENT IS WINNING ====================
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)

        if has_lead:
            # Following suit:
            winning_indices = [i for i in valid_indices if hand[i]['power'] > winning_card['power']]

            if winning_indices:
                if seat_in_trick == 3:
                    # 4th seat (last): win with the CHEAPEST card that beats opponent!
                    winning_indices.sort(key=lambda i: hand[i]['power'])
                    return {'card_index': winning_indices[0], 'reveal_trump': False}
                else:
                    # 2nd or 3rd seat:
                    # If high stakes (trick points >= 2 or opponent played J/9): take trick with boss/master
                    if trick_points >= 2 or winning_card['rank'] in ['J', '9']:
                        winning_indices.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': winning_indices[0], 'reveal_trump': False}
                    else:
                        # Low stakes trick: Second Hand Low! Duck with lowest card
                        valid_indices.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': valid_indices[0], 'reveal_trump': False}
            else:
                # Cannot beat opponent: DUCK! Play lowest 0-value card
                valid_indices.sort(key=lambda i: (hand[i]['value'], hand[i]['power']))
                return {'card_index': valid_indices[0], 'reveal_trump': False}

        else:
            # Void in lead suit:
            if trump_revealed or reveal_trump:
                trumps = [i for i in valid_indices if hand[i]['suit'] == trump_suit]
                if trumps:
                    # Can we cut?
                    if winning_card['suit'] == trump_suit:
                        # Opponent already trumped, can we over-trump?
                        overtrumps = [i for i in trumps if hand[i]['power'] > winning_card['power']]
                        if overtrumps and (trick_points >= 2 or winning_card['value'] >= 2):
                            overtrumps.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': overtrumps[0], 'reveal_trump': reveal_trump}
                        else:
                            # Not worth over-trumping or cannot over-trump: discard garbage
                            non_trumps = [i for i in valid_indices if hand[i]['suit'] != trump_suit]
                            if non_trumps:
                                non_trumps.sort(key=lambda i: discard_cost(i))
                                return {'card_index': non_trumps[0], 'reveal_trump': False}
                            else:
                                trumps.sort(key=lambda i: hand[i]['power'])
                                return {'card_index': trumps[0], 'reveal_trump': reveal_trump}
                    else:
                        # Opponent played non-trump: cut with CHEAPEST trump!
                        trumps.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': trumps[0], 'reveal_trump': reveal_trump}

            # No trump or cannot cut: discard lowest useless card
            valid_indices.sort(key=lambda i: discard_cost(i))
            return {'card_index': valid_indices[0], 'reveal_trump': False}

    return {'card_index': best_card_idx, 'reveal_trump': reveal_trump}


class handler(BaseHTTPRequestHandler):
    """Vercel Serverless Function Handler"""

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path.endswith('/health') or path.endswith('/status'):
            self._send_json(200, {'status': 'healthy', 'service': '28-game-expert-ai-backend', 'version': '2.1.0'})
        else:
            self._send_json(200, {
                'message': '28 Game High-Intelligence Python Engine Active',
                'version': '2.1.0',
                'endpoints': ['/api/deal', '/api/bid', '/api/trump', '/api/play', '/api/health']
            })

    def do_POST(self):
        path = urlparse(self.path).path
        content_length = int(self.headers.get('Content-Length', 0))
        data = {}
        if content_length > 0:
            try:
                body_str = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body_str) if body_str else {}
            except Exception as e:
                self._send_json(400, {'error': f'Invalid JSON payload: {str(e)}'})
                return

        # Route matching
        if 'deal' in path:
            res = deal_cards()
            self._send_json(200, res)
        elif 'bid' in path:
            hand = data.get('hand', [])
            current_bid = data.get('current_bid', 15)
            highest_bidder = data.get('highest_bidder', -1)
            player_idx = data.get('player_idx', 0)
            pass_count = data.get('pass_count', 0)
            res = evaluate_bidding(hand, current_bid, highest_bidder, player_idx, pass_count)
            self._send_json(200, res)
        elif 'trump' in path:
            hand = data.get('hand', [])
            res = select_ai_trump(hand)
            self._send_json(200, res)
        elif 'play' in path:
            hand = data.get('hand', [])
            trick_cards = data.get('trick_cards', [])
            lead_suit = data.get('lead_suit', None)
            trump_suit = data.get('trump_suit', None)
            trump_revealed = data.get('trump_revealed', False)
            player_idx = data.get('player_idx', 0)
            played_history = data.get('played_history', [])
            void_suits = data.get('void_suits', {})
            res = evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits)
            self._send_json(200, res)
        else:
            self._send_json(404, {'error': f'Route not found: {path}'})
