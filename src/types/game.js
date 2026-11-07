/**
 * 28 Game - Types & Constants
 * Defines core suits, ranks, point values, power hierarchy, and phase states.
 */

export const SUITS = ['♠', '♥', '♣', '♦'];

export const SUIT_NAMES = {
    '♠': 'spades',
    '♥': 'hearts',
    '♣': 'clubs',
    '♦': 'diamonds'
};

export const RANKS = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];

/**
 * 28 Card Point Values:
 * J = 3 pts
 * 9 = 2 pts
 * A = 1 pt
 * 10 = 1 pt
 * K, Q, 8, 7 = 0 pts
 * Total = 28 pts
 */
export const CARD_POINTS = {
    'J': 3,
    '9': 2,
    'A': 1,
    '10': 1,
    'K': 0,
    'Q': 0,
    '8': 0,
    '7': 0
};

/**
 * Trick-taking Power Hierarchy in 28:
 * J (highest) > 9 > A > 10 > K > Q > 8 > 7 (lowest)
 */
export const CARD_POWER = {
    'J': 8,
    '9': 7,
    'A': 6,
    '10': 5,
    'K': 4,
    'Q': 3,
    '8': 2,
    '7': 1
};

export const GAME_PHASES = {
    LOBBY: 'LOBBY',
    DEALING_1: 'DEALING_1',
    BIDDING: 'BIDDING',
    SET_TRUMP: 'SET_TRUMP',
    DEALING_2: 'DEALING_2',
    PLAYING: 'PLAYING',
    TRICK_OVER: 'TRICK_OVER',
    ROUND_OVER: 'ROUND_OVER'
};

export const COMPASS_DIRECTIONS = ['South', 'East', 'North', 'West'];
export const COMPASS_SHORT = ['S', 'E', 'N', 'W'];
