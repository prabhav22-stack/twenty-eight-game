import os
import io
import streamlit as st
import streamlit.components.v1 as components
import qrcode
from PIL import Image

# ==================== STREAMLIT CONFIGURATION ====================
st.set_page_config(
    page_title="Twenty-Eight (28) - Royal Casino Edition",
    page_icon="🃏",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Responsive full-screen CSS: eliminates all Streamlit outer padding, scrollbars, and headers
st.markdown("""
<style>
    /* Remove all Streamlit page margins and scrollbars */
    html, body, [data-testid="stAppViewContainer"], [data-testid="stMain"], [data-testid="stMainBlockContainer"], .block-container {
        height: 100vh !important;
        max-height: 100vh !important;
        min-height: 100vh !important;
        width: 100vw !important;
        max-width: 100vw !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
    }
    
    /* Hide Streamlit top header bar to maximize screen real estate */
    header[data-testid="stHeader"] {
        display: none !important;
    }
    footer {
        display: none !important;
    }
    
    /* Force custom component wrapper & iframe to fill exact 100% of device screen */
    div[data-testid="stCustomComponentV1"],
    div[data-testid="stCustomComponentV1"] > iframe,
    iframe {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        height: 100dvh !important;
        min-height: 100vh !important;
        max-height: 100vh !important;
        border: none !important;
        margin: 0 !important;
        padding: 0 !important;
        z-index: 10 !important;
    }

    /* Keep sidebar functional and styled when opened */
    section[data-testid="stSidebar"] {
        background-color: #05140b;
        border-right: 1.5px solid rgba(229, 193, 88, 0.35);
        z-index: 999999 !important;
    }
    .stSidebar .stMarkdown h1, .stSidebar .stMarkdown h2, .stSidebar .stMarkdown h3 {
        color: #e5c158 !important;
        font-family: 'Cinzel', serif;
    }
</style>
""", unsafe_allow_html=True)

# ==================== QUERY PARAMS & URL HELPER ====================
query_params = st.query_params
initial_room = query_params.get("room", "")
initial_mode = query_params.get("mode", "FULL")
initial_name = query_params.get("name", "")

# ==================== SIDEBAR CONTROLS & RULES ====================
with st.sidebar:
    st.markdown("### 👑 TWENTY-EIGHT (28)")
    st.caption("Royal Casino Multiplayer • Web Edition")
    
    # Room Management
    st.subheader("🌐 Multiplayer Room")
    room_code = st.text_input("Room Code", value=initial_room, placeholder="e.g. ROYAL28").strip().upper()
    
    # Generate QR Code & Invite Link
    if room_code:
        invite_url = f"?room={room_code}"
        st.markdown(f"**Room Code:** `{room_code}`")
        
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=6,
            border=2,
        )
        qr.add_data(invite_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#09150d", back_color="#ffffff")
        
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        st.image(buf.getvalue(), caption="Scan to join on mobile", width=180)
        st.caption("Share this room code with friends across the internet!")

    st.divider()

    # Table Felt Theme
    st.subheader("🎨 Casino Table Theme")
    theme = st.selectbox(
        "Felt Color",
        ["Emerald Green", "Midnight Sapphire", "Crimson Velvet"],
        index=0
    )
    theme_class = ""
    if theme == "Midnight Sapphire":
        theme_class = "theme-sapphire"
    elif theme == "Crimson Velvet":
        theme_class = "theme-crimson"

    st.divider()

    # Card Values & Rules Guide
    with st.expander("📖 28 Point System & Card Power", expanded=False):
        st.markdown("""
        **Total Deck Points: 28 PTS**
        
        | Rank | Card Points | Power Rank |
        | :--- | :--- | :--- |
        | **Jack (J)** | **3 PTS** | 1st (Highest) |
        | **Nine (9)** | **2 PTS** | 2nd |
        | **Ace (A)** | **1 PT** | 3rd |
        | **Ten (10)** | **1 PT** | 4th |
        | **King (K)** | 0 PTS | 5th |
        | **Queen (Q)**| 0 PTS | 6th |
        | **Eight (8)**| 0 PTS | 7th |
        | **Seven (7)**| 0 PTS | 8th (Lowest) |
        """)
        
    with st.expander("🏆 How to Play 28", expanded=False):
        st.markdown("""
        1. **4 Players in 2 Teams:**
           - Team 1: **SOUTH** & **NORTH**
           - Team 2: **EAST** & **WEST**
        2. **Deal 1 & Bidding:**
           - 4 cards dealt to each player.
           - Bidding starts at minimum **16** (up to 28).
           - Winner chooses **Secret Trump**, tucked face down.
        3. **Deal 2 & Playing:**
           - Remaining 4 cards dealt (8 cards total).
           - Must follow the lead suit if possible.
           - If you don't have the lead suit, you can **Reveal Trump**!
        4. **Royal K-Q Pair:**
           - If a team holds King + Queen of trump after trump is revealed and has won at least 1 trick, declaring pair adjusts the target by **±4 PTS**.
        5. **Round Scoring:**
           - Bidding team wins game points if they reach their bid target; otherwise penalty points are deducted!
        """)
        
    st.caption("Antigravity 28 Royal Edition • P2P WebRTC Multiplayer")

# ==================== LOAD & PREPARE GAME HTML ====================
html_path = os.path.join(os.path.dirname(__file__), "game.html")
if not os.path.exists(html_path):
    st.error("game.html file not found!")
    st.stop()

with open(html_path, "r", encoding="utf-8") as f:
    game_html = f.read()

# Inject theme class if selected
if theme_class:
    game_html = game_html.replace('<body>', f'<body class="{theme_class}">')

# Inject initial room code / query params into the HTML script
init_script = f"""
<script>
window.addEventListener('DOMContentLoaded', () => {{
    const urlRoom = "{room_code or initial_room}";
    const urlName = "{initial_name}";
    if (urlRoom) {{
        const rInput = document.getElementById('room-code-input');
        if (rInput) rInput.value = urlRoom;
    }}
    if (urlName) {{
        const nInput = document.getElementById('player-name-input');
        if (nInput) nInput.value = urlName;
    }}
}});
</script>
"""
game_html = game_html.replace('</body>', f'{init_script}</body>')

# Render iframe component - CSS ensures it stretches to 100vh on any display
components.html(game_html, height=720, scrolling=False)
