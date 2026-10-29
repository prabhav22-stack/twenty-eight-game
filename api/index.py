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
    Intelligent AI bidding logic based on standard 28 auction principles:
    - Evaluates 4-card Phase 1 hand.
    - Honors count: J (3 pts), 9 (2 pts), A (1 pt), 10 (1 pt).
    - Long suit and honor distribution.
    - Partnership awareness: don't overbid partner if partner already holds contract,
      unless holding extraordinary strength (>= 20).
    - Forced dealer bid: if all 3 previous players passed, dealer (idx 3 from starter) must bid 16.
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

    for c in hand:
        s = c['suit']
        r = c['rank']
        val = CARD_VALUES.get(r, 0)
        pwr = CARD_POWER.get(r, 0)
        suit_counts[s] += 1
        suit_points[s] += val
        suit_powers[s] += pwr
        if r == 'J': jacks.append(s)
        if r == '9': nines.append(s)

    total_pts = sum(suit_points.values())
    max_suit_count = max(suit_counts.values())
    best_suit = max(SUITS, key=lambda s: (suit_counts[s], suit_powers[s]))

    # Calculate bidding strength
    bid_strength = 14
    bid_strength += total_pts * 1.5

    # Jack bonus: Jacks are the trump controllers
    if len(jacks) >= 1:
        bid_strength += 2.0
    if len(jacks) >= 2:
        bid_strength += 3.5

    # Jack + Nine in same suit is a very strong anchor
    for s in jacks:
        if s in nines:
            bid_strength += 2.5

    # Length bonus in best suit
    if max_suit_count >= 3:
        bid_strength += 2.0
    if max_suit_count == 4:
        bid_strength += 3.5

    # Voids / singletons off-suit allow trumping in round 2
    voids = sum(1 for s in SUITS if suit_counts[s] == 0)
    bid_strength += voids * 0.75

    max_willing_bid = int(bid_strength)

    # If partner holds the contract:
    if partner_is_highest:
        # Don't step on partner unless we have exceptional hand (e.g. 20+)
        if max_willing_bid >= 20 and max_willing_bid > min_required:
            return {'bid': min_required}
        return {'bid': 'Pass'}

    # If dealer forced to bid (pass_count == 3 and current_bid < 16):
    if pass_count == 3 and current_bid < 16:
        return {'bid': 16}

    if max_willing_bid >= min_required and min_required <= 24:
        return {'bid': min_required}

    return {'bid': 'Pass'}

def select_ai_trump(hand):
    """Selects optimal trump suit for AI based on honours and suit depth."""
    suit_scores = {s: 0 for s in SUITS}
    suit_counts = {s: 0 for s in SUITS}

    for c in hand:
        s = c['suit']
        suit_counts[s] += 1
        suit_scores[s] += c.get('power', CARD_POWER.get(c['rank'], 0))
        suit_scores[s] += c.get('value', CARD_VALUES.get(c['rank'], 0)) * 2
        if c['rank'] == 'J':
            suit_scores[s] += 10
        elif c['rank'] == '9':
            suit_scores[s] += 6

    # Score combines count and honor strength
    best_suit = max(SUITS, key=lambda s: (suit_counts[s] * 12 + suit_scores[s]))
    return {'trump_suit': best_suit}

def evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits):
    """
    Expert AI card play decision maker:
    - Enforces legal moves: Must follow lead_suit if present in hand.
    - Trump reveal rules: Trump can NEVER be revealed on Trick 1.
    - If void in lead suit (and trick > 0 and not trick 1), decides whether to reveal trump.
    - Strategic card selection:
      * Smearing points on partner's winning trick.
      * Ducking / conserving honours on lost tricks.
      * Winning cheaply over opponents.
      * Leading master cards or establishing long suits.
    """
    total_played_rounds = len(played_history) // 4
    is_trick_one = (total_played_rounds == 0)

    # 1. Determine valid legal plays
    if not trick_cards:
        # Leading the trick
        valid_indices = list(range(len(hand)))
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            valid_indices = [i for i, c in enumerate(hand) if c['suit'] == lead_suit]
        else:
            valid_indices = list(range(len(hand)))

    # Determine current winning play in the trick
    current_winner_player = None
    winning_card = None
    trick_points = sum(c['card']['value'] for c in trick_cards) if trick_cards else 0

    if trick_cards:
        # Evaluate current winner
        best_play = trick_cards[0]
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
        current_winner_player = best_play['player']
        winning_card = best_play['card']

    partner_idx = (player_idx + 2) % 4
    partner_is_winning = (current_winner_player == partner_idx)

    reveal_trump = False

    # Check if AI should reveal trump
    if (trick_cards and not trump_revealed and not is_trick_one):
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if not has_lead:
            # Void in lead suit!
            # Should we reveal trump?
            # Yes if:
            # 1. We have trump cards
            # 2. Trick has high points (>= 2 pts) OR opponent is winning with a high honour (J/9) OR we have strong trumps to win
            has_trumps = any(c['suit'] == trump_suit for c in hand)
            if has_trumps and not partner_is_winning:
                if trick_points >= 2 or (winning_card and winning_card['rank'] in ['J', '9', 'A']):
                    reveal_trump = True

    # Choose best card among valid indices
    best_card_idx = valid_indices[0]

    if not trick_cards:
        # LEADING:
        # Prefer leading master cards (Jack, or remaining highest in a suit)
        # Avoid leading unprotected Aces if 9 and J are out
        ranked_leads = []
        for i in valid_indices:
            c = hand[i]
            score = 0
            if c['rank'] == 'J': score += 10
            elif c['rank'] == '9': score += 4
            elif c['rank'] in ['8', '7']: score += 2
            elif c['rank'] in ['K', 'Q']: score += 1
            ranked_leads.append((score, i))
        ranked_leads.sort(reverse=True)
        best_card_idx = ranked_leads[0][1]

    elif partner_is_winning:
        # Partner is winning trick!
        # If following suit:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            # Smear points (10, 9, A) if partner has J/winning card, else play lowest
            if winning_card and winning_card['rank'] == 'J':
                # Partner definitely wins with Jack! Dump maximum points (10, 9, A)
                point_cards = [(hand[i]['value'], hand[i]['power'], i) for i in valid_indices]
                point_cards.sort(reverse=True)
                best_card_idx = point_cards[0][2]
            else:
                # Play safe / lowest power
                low_cards = [(hand[i]['power'], i) for i in valid_indices]
                low_cards.sort()
                best_card_idx = low_cards[0][1]
        else:
            # Void in suit, partner winning: discard useless card (7/8 or unneeded suit)
            junk_cards = [(hand[i]['value'], hand[i]['power'], i) for i in valid_indices]
            junk_cards.sort() # lowest value, lowest power
            best_card_idx = junk_cards[0][2]

    else:
        # Opponent is winning or leading:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            # Try to beat opponent's winning card with lowest possible winner
            winners = [i for i in valid_indices if hand[i]['suit'] == winning_card['suit'] and hand[i]['power'] > winning_card['power']]
            if winners:
                # Play cheapest winner
                winners.sort(key=lambda i: hand[i]['power'])
                best_card_idx = winners[0]
            else:
                # Can't beat it: duck! Play lowest useless card
                non_winners = [(hand[i]['value'], hand[i]['power'], i) for i in valid_indices]
                non_winners.sort()
                best_card_idx = non_winners[0][2]
        else:
            # Void in suit:
            if trump_revealed:
                trumps = [i for i in valid_indices if hand[i]['suit'] == trump_suit]
                if trumps:
                    # Can we cut the trick?
                    if winning_card['suit'] == trump_suit:
                        # Opponent already trumped, can we over-trump?
                        overtrumps = [i for i in trumps if hand[i]['power'] > winning_card['power']]
                        if overtrumps:
                            overtrumps.sort(key=lambda i: hand[i]['power'])
                            best_card_idx = overtrumps[0]
                        else:
                            # Dump junk non-trump card
                            non_trumps = [i for i in valid_indices if hand[i]['suit'] != trump_suit]
                            if non_trumps:
                                non_trumps.sort(key=lambda i: (hand[i]['value'], hand[i]['power']))
                                best_card_idx = non_trumps[0]
                            else:
                                trumps.sort(key=lambda i: hand[i]['power'])
                                best_card_idx = trumps[0]
                    else:
                        # Win with lowest trump
                        trumps.sort(key=lambda i: hand[i]['power'])
                        best_card_idx = trumps[0]
                else:
                    # No trumps: sluff lowest card
                    junk = [(hand[i]['value'], hand[i]['power'], i) for i in valid_indices]
                    junk.sort()
                    best_card_idx = junk[0][2]
            else:
                # Trump not revealed: discard lowest non-point card
                junk = [(hand[i]['value'], hand[i]['power'], i) for i in valid_indices]
                junk.sort()
                best_card_idx = junk[0][2]

    return {
        'card_index': best_card_idx,
        'reveal_trump': reveal_trump
    }


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
            self._send_json(200, {'status': 'healthy', 'service': '28-game-backend', 'version': '2.0.0'})
        else:
            self._send_json(200, {
                'message': '28 Game Python Engine API Active',
                'endpoints': ['/api/deal', '/api/bid', '/api/trump', '/api/play']
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
        if path.endswith('/deal'):
            res = deal_cards()
            self._send_json(200, res)
        elif path.endswith('/bid'):
            hand = data.get('hand', [])
            current_bid = data.get('current_bid', 15)
            highest_bidder = data.get('highest_bidder', -1)
            player_idx = data.get('player_idx', 0)
            pass_count = data.get('pass_count', 0)
            res = evaluate_bidding(hand, current_bid, highest_bidder, player_idx, pass_count)
            self._send_json(200, res)
        elif path.endswith('/trump'):
            hand = data.get('hand', [])
            res = select_ai_trump(hand)
            self._send_json(200, res)
        elif path.endswith('/play'):
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
