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
            "temperature": 0.65,
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

def evaluate_bidding(hand, current_bid, highest_bidder, player_idx, pass_count=0):
    """
    Expert AI bidding logic:
    - True 28 card valuation: Jacks (3 pts), Nines (2 pts), Aces (1 pt), Tens (1 pt).
    - Jack + Nine anchor calculation.
    - Partner awareness: Always pass if partner already holds the contract.
    """
    current_bid = int(current_bid) if current_bid is not None else 15
    min_required = max(16, current_bid + 1)
    
    partner_idx = (player_idx + 2) % 4
    partner_is_highest = (highest_bidder == partner_idx)

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

    bid_strength = 13.0 + (total_pts * 1.5)

    if len(jacks) == 1: bid_strength += 2.5
    elif len(jacks) >= 2: bid_strength += 4.5

    for s in jacks:
        if s in nines: bid_strength += 3.0
        if s in aces: bid_strength += 1.5

    for s in nines:
        if s not in jacks and suit_counts[s] >= 2:
            bid_strength += 1.0

    if max_suit_count == 3: bid_strength += 2.5
    elif max_suit_count == 4: bid_strength += 4.5

    voids = sum(1 for s in SUITS if suit_counts[s] == 0)
    bid_strength += voids * 0.8

    max_willing_bid = int(bid_strength)

    # 1. Partner awareness: If partner holds the contract, always pass to support partner!
    if partner_is_highest:
        return {'bid': 'Pass'}

    # 2. Forced dealer bid rule
    if pass_count == 3 and current_bid < 16:
        return {'bid': 16}

    # 3. Competitive bidding against opponents
    if max_willing_bid >= min_required and min_required <= 24:
        return {'bid': min_required}

    return {'bid': 'Pass'}

def generate_bidding_dialogue(hand, current_bid, highest_bidder, player_idx, bid_action, language='en'):
    """Generates natural in-character bidding table banter using Groq LLM."""
    p_name = SEAT_NAMES[player_idx]
    is_partner = (player_idx == 2)
    role_desc = "Partner to South (human player)" if is_partner else "Opponent to South"
    cards_str = ", ".join([f"{c['rank']}{c['suit']}" for c in hand])

    # Default fallback quips
    if language == 'hi':
        fallback = "पास करता हूँ।" if bid_action == 'Pass' else f"{bid_action} की बोली!"
    else:
        fallback = "Passing this round." if bid_action == 'Pass' else f"Bidding {bid_action}!"

    prompt = (
        f"You are {p_name} ({role_desc}) playing the card game Twenty-Eight (28).\n"
        f"Your 4 cards: {cards_str}.\n"
        f"Current high bid: {current_bid}.\n"
        f"Your bidding action: {bid_action}.\n"
        f"Language requested: {'Hindi (Devanagari script)' if language == 'hi' else 'English'}.\n"
        "Generate a brief, natural 3 to 6 word card-table dialogue reflecting your personality and action."
    )
    messages = [
        {"role": "system", "content": "You are a lively card player in a 28 match. Return JSON with key 'dialogue'."},
        {"role": "user", "content": prompt}
    ]
    res = call_groq(messages, timeout=1.4)
    if res and isinstance(res, dict) and 'dialogue' in res:
        return res['dialogue'].strip(' "')
    return fallback

def select_ai_trump(hand):
    """Selects optimal trump suit for AI."""
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

def is_master_card(card, played_history, current_trick):
    """Checks if a card is currently the highest unplayed card of its suit."""
    if card['rank'] == 'J': return True
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
    if not trick_cards: return None, None, 0
    best_play = trick_cards[0]
    points = sum(tc['card']['value'] for tc in trick_cards)
    for play in trick_cards[1:]:
        c = play['card']
        w = best_play['card']
        is_c_trump = (trump_revealed and c['suit'] == trump_suit)
        is_w_trump = (trump_revealed and w['suit'] == trump_suit)
        if is_c_trump and not is_w_trump: best_play = play
        elif is_c_trump and is_w_trump:
            if c['power'] > w['power']: best_play = play
        elif not is_c_trump and not is_w_trump:
            if c['suit'] == lead_suit and (w['suit'] != lead_suit or c['power'] > w['power']):
                best_play = play
    return best_play['player'], best_play['card'], points

def evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits):
    """
    World-Class 28 AI Card Play Engine with Smearing, Ducking, and Master Leads.
    """
    partner_idx = (player_idx + 2) % 4
    opp1_idx = (player_idx + 1) % 4
    opp2_idx = (player_idx + 3) % 4

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
    seat_in_trick = len(trick_cards)

    reveal_trump = False
    if trick_cards and not trump_revealed:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if not has_lead:
            has_trumps = any(c['suit'] == trump_suit for c in hand)
            if has_trumps and not partner_is_winning:
                high_value_target = (trick_points >= 2) or (winning_card and winning_card['rank'] in ['J', '9', 'A'])
                if high_value_target:
                    reveal_trump = True

    def discard_cost(i):
        c = hand[i]
        cost = c['value'] * 25 + c['power']
        if trump_suit and c['suit'] == trump_suit:
            cost += 120
            if c['rank'] in ['K', 'Q']: cost += 80
        return cost

    def smear_value(i):
        c = hand[i]
        if c['suit'] == trump_suit: return -100
        if c['rank'] == '10': return 80
        elif c['rank'] == '9': return 70
        elif c['rank'] == 'A': return 60
        elif c['rank'] == 'J': return 50
        return -c['power']

    best_card_idx = valid_indices[0]
    action_type = "lead"

    # Case 1: Leading Trick
    if seat_in_trick == 0:
        action_type = "lead"
        master_indices = [i for i in valid_indices if is_master_card(hand[i], played_history, trick_cards)]
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
            safe_masters.sort(key=lambda i: (hand[i]['value'], hand[i]['power']), reverse=True)
            return {'card_index': safe_masters[0], 'reveal_trump': False, 'action_type': 'lead_master'}

        for s in SUITS:
            j_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == 'J'), None)
            nine_idx = next((i for i in valid_indices if hand[i]['suit'] == s and hand[i]['rank'] == '9'), None)
            if j_idx is not None and nine_idx is not None:
                return {'card_index': j_idx, 'reveal_trump': False, 'action_type': 'lead_jack_nine'}

        if trump_revealed:
            for s in SUITS:
                if s != trump_suit and void_suits.get(str(partner_idx), {}).get(s):
                    if not void_suits.get(str(opp1_idx), {}).get(s) and not void_suits.get(str(opp2_idx), {}).get(s):
                        suit_cards = [i for i in valid_indices if hand[i]['suit'] == s and hand[i]['value'] == 0]
                        if suit_cards:
                            suit_cards.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': suit_cards[0], 'reveal_trump': False, 'action_type': 'partner_crossruff'}

        suit_counts = {s: sum(1 for c in hand if c['suit'] == s) for s in SUITS}
        valid_indices.sort(key=lambda i: (hand[i]['value'], -suit_counts[hand[i]['suit']], hand[i]['power']))
        return {'card_index': valid_indices[0], 'reveal_trump': False, 'action_type': 'lead_safe'}

    # Case 2: Partner is Winning
    elif partner_is_winning:
        is_last_seat = (seat_in_trick == 3)
        partner_has_boss = is_master_card(winning_card, played_history, trick_cards)
        partner_safe = is_last_seat or partner_has_boss

        has_lead = any(c['suit'] == lead_suit for c in hand)
        if partner_safe:
            action_type = "smear" if any(hand[i]['value'] > 0 for i in valid_indices) else "support_partner"
            valid_indices.sort(key=lambda i: smear_value(i), reverse=True)
            return {'card_index': valid_indices[0], 'reveal_trump': False, 'action_type': action_type}
        else:
            action_type = "protect_partner"
            if has_lead:
                bosses = [i for i in valid_indices if is_master_card(hand[i], played_history, trick_cards)]
                if bosses and trick_points >= 1:
                    return {'card_index': bosses[0], 'reveal_trump': False, 'action_type': 'win_boss'}
                valid_indices.sort(key=lambda i: hand[i]['power'])
                return {'card_index': valid_indices[0], 'reveal_trump': False, 'action_type': 'duck'}
            else:
                valid_indices.sort(key=lambda i: discard_cost(i))
                return {'card_index': valid_indices[0], 'reveal_trump': False, 'action_type': 'duck'}

    # Case 3: Opponent is Winning
    else:
        has_lead = any(c['suit'] == lead_suit for c in hand)
        if has_lead:
            winning_indices = [i for i in valid_indices if hand[i]['power'] > winning_card['power']]
            if winning_indices:
                if seat_in_trick == 3:
                    action_type = "win_cheap"
                    winning_indices.sort(key=lambda i: hand[i]['power'])
                    return {'card_index': winning_indices[0], 'reveal_trump': False, 'action_type': action_type}
                else:
                    if trick_points >= 2 or winning_card['rank'] in ['J', '9']:
                        action_type = "win_high"
                        winning_indices.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': winning_indices[0], 'reveal_trump': False, 'action_type': action_type}
                    else:
                        action_type = "duck"
                        valid_indices.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': valid_indices[0], 'reveal_trump': False, 'action_type': action_type}
            else:
                action_type = "duck"
                valid_indices.sort(key=lambda i: (hand[i]['value'], hand[i]['power']))
                return {'card_index': valid_indices[0], 'reveal_trump': False, 'action_type': action_type}
        else:
            if trump_revealed or reveal_trump:
                trumps = [i for i in valid_indices if hand[i]['suit'] == trump_suit]
                if trumps:
                    if winning_card['suit'] == trump_suit:
                        overtrumps = [i for i in trumps if hand[i]['power'] > winning_card['power']]
                        if overtrumps and (trick_points >= 2 or winning_card['value'] >= 2):
                            overtrumps.sort(key=lambda i: hand[i]['power'])
                            return {'card_index': overtrumps[0], 'reveal_trump': reveal_trump, 'action_type': 'overtrump'}
                        else:
                            non_trumps = [i for i in valid_indices if hand[i]['suit'] != trump_suit]
                            if non_trumps:
                                non_trumps.sort(key=lambda i: discard_cost(i))
                                return {'card_index': non_trumps[0], 'reveal_trump': False, 'action_type': 'sluff'}
                            else:
                                trumps.sort(key=lambda i: hand[i]['power'])
                                return {'card_index': trumps[0], 'reveal_trump': reveal_trump, 'action_type': 'sluff_trump'}
                    else:
                        trumps.sort(key=lambda i: hand[i]['power'])
                        return {'card_index': trumps[0], 'reveal_trump': reveal_trump, 'action_type': 'trump_cut'}

            valid_indices.sort(key=lambda i: discard_cost(i))
            return {'card_index': valid_indices[0], 'reveal_trump': False, 'action_type': 'duck'}

def generate_play_dialogue(card, action_type, player_idx, language='en'):
    """Generates dynamic table speech for smearing, ducking, cutting, or winning tricks."""
    p_name = SEAT_NAMES[player_idx]
    is_partner = (player_idx == 2)
    role_desc = "Partner to South" if is_partner else "Opponent"
    card_str = f"{card['rank']}{card['suit']}"

    # Default fallback quips
    if language == 'hi':
        if action_type == 'smear': fallback = "पार्टनर, यह अंक आपके!"
        elif action_type == 'duck': fallback = "एक भी अंक नहीं मिलेगा!"
        elif action_type in ['trump_cut', 'overtrump']: fallback = "हुकुम की काट!"
        elif action_type in ['win_cheap', 'win_high']: fallback = "यह चाल मेरी!"
        else: fallback = f"{card_str} खेलता हूँ।"
    else:
        if action_type == 'smear': fallback = "Points for you, partner!"
        elif action_type == 'duck': fallback = "Ducking this trick."
        elif action_type in ['trump_cut', 'overtrump']: fallback = "Cutting with trump!"
        elif action_type in ['win_cheap', 'win_high']: fallback = "Taking this trick!"
        else: fallback = f"Playing {card_str}."

    prompt = (
        f"You are {p_name} ({role_desc}) in Twenty-Eight card game.\n"
        f"You just played {card_str}.\n"
        f"Action: {action_type} (e.g. smearing points, ducking zero points, or cutting with trump).\n"
        f"Language: {'Hindi (Devanagari)' if language == 'hi' else 'English'}.\n"
        "Generate a punchy 2 to 5 word table reaction in JSON with key 'dialogue'."
    )
    messages = [
        {"role": "system", "content": "You are a witty card game player. Return JSON with 'dialogue' key."},
        {"role": "user", "content": prompt}
    ]
    res = call_groq(messages, timeout=1.4)
    if res and isinstance(res, dict) and 'dialogue' in res:
        return res['dialogue'].strip(' "')
    return fallback

def generate_round_recap(bidding_winner, contract, bidding_team, t1_pts, t2_pts, success, trump_suit, pair_declared, language='en'):
    """Generates punchy AI Coach match analysis using Groq LLM."""
    winner_name = SEAT_NAMES[bidding_winner] if bidding_winner in range(4) else f"Player {bidding_winner}"
    team_name = f"Team {bidding_team} ({winner_name})"
    pair_note = "Royal K-Q Pair declared (+4 pts target adjustment)." if pair_declared else ""

    if language == 'hi':
        fallback = f"{team_name} ने {contract} की बोली {t1_pts if bidding_team == 1 else t2_pts} अंक बनाकर {'जीत ली' if success else 'हार दी'}।"
    else:
        fallback = f"{team_name} {'successfully made' if success else 'failed to fulfill'} the {contract}-point contract with {t1_pts if bidding_team == 1 else t2_pts} points."

    prompt = (
        f"Round finished in South Asian 28 Card Game:\n"
        f"- Contract: {contract} points bid by {winner_name} (Team {bidding_team})\n"
        f"- Trump Suit: {trump_suit}\n"
        f"- Final Round Score: Team 1 ({t1_pts} pts) vs Team 2 ({t2_pts} pts)\n"
        f"- Outcome: {'VICTORY (Target achieved)' if success else 'DEFEATED (Target missed)'}\n"
        f"- {pair_note}\n"
        f"Language requested: {'Hindi (Devanagari script)' if language == 'hi' else 'English'}.\n"
        "Write a 2-sentence punchy, professional coach match analysis in JSON with key 'recap'."
    )
    messages = [
        {"role": "system", "content": "You are a grandmaster 28 card game analyst. Return JSON with 'recap' key."},
        {"role": "user", "content": prompt}
    ]
    res = call_groq(messages, timeout=2.2)
    if res and isinstance(res, dict) and 'recap' in res:
        return res['recap'].strip(' "')
    return fallback


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
        raw_path = self.headers.get('x-matched-path') or self.path or ''
        self._send_json(200, {
            'status': 'healthy',
            'service': '28-game-groq-ai-backend',
            'version': '2.2.0',
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

        # Flexible route matching: checks x-matched-path, query string (?route=...), or body action
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
            language = data.get('language', 'en')
            res = evaluate_bidding(hand, current_bid, highest_bidder, player_idx, pass_count)
            dialogue = generate_bidding_dialogue(hand, current_bid, highest_bidder, player_idx, res['bid'], language)
            res['dialogue'] = dialogue
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
            language = data.get('language', 'en')
            res = evaluate_ai_play(hand, trick_cards, lead_suit, trump_suit, trump_revealed, player_idx, played_history, void_suits)
            played_card = hand[res['card_index']] if 0 <= res['card_index'] < len(hand) else {'rank': '?', 'suit': ''}
            dialogue = generate_play_dialogue(played_card, res.get('action_type', 'play'), player_idx, language)
            res['dialogue'] = dialogue
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
            recap_text = generate_round_recap(bidding_winner, contract, bidding_team, t1_pts, t2_pts, success, trump_suit, pair_declared, language)
            self._send_json(200, {'recap': recap_text})

        else:
            self._send_json(404, {'error': f'Route not found: {raw_path}'})
