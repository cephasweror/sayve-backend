# Sayve - WhatsApp AI Expense & Income Tracker Backend 🇳🇬

Sayve is a WhatsApp-based AI expense and income tracking system designed specifically for Nigerian small business owners. Users send natural-language **text messages** or **voice notes** describing transactions (*"sold 3 bags of rice for 45000"*, *"spent 5000 on transport"*), and Sayve automatically transcribes voice notes (via Groq Whisper), parses them using Groq LLM (Llama 3.3 70B) with Gemini Flash fallback, logs them into MongoDB, and generates summaries and CSV report exports on command — all directly within WhatsApp.

---

## 🛠️ Tech Stack

- **Backend Framework**: Node.js & Express (TypeScript)
- **WhatsApp Integration**: Meta WhatsApp Business Cloud API (Official REST API)
- **LLM Engine**: Primary: Groq API (`llama-3.3-70b-versatile`) | Fallback: Google Gemini Flash (`gemini-1.5-flash`)
- **Voice Note Transcription**: Groq Whisper API (`whisper-large-v3`) — supports English, Nigerian Pidgin & mixed languages
- **Database**: MongoDB (Mongoose ORM)
- **Export Engine**: CSV Generator (`json2csv`)

---

## 🚀 Getting Started

### 1. Environment Variables Configuration

Copy `.env.example` to `.env` in the root directory:

```bash
cp .env.example .env
```

Fill in your actual API keys and tokens:

```env
# Server
PORT=3000
NODE_ENV=development

# Meta WhatsApp Business Cloud API Credentials
WHATSAPP_TOKEN=EAAG... (Meta System User Bearer Access Token)
PHONE_NUMBER_ID=1234567890 (WhatsApp Test/Production Phone Number ID)
WHATSAPP_VERIFY_TOKEN=sayve_webhook_secret_token (Custom verification secret)

# LLM Provider API Keys
GROQ_API_KEY=gsk_... (Groq Console API Key)
GEMINI_API_KEY=AIza... (Google AI Studio API Key)

# MongoDB Connection
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/sayve_db?retryWrites=true&w=majority
```

---

### 2. Local Development & ngrok Testing Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Development Server**:
   ```bash
   npm run dev
   ```
   *The server starts locally at `http://localhost:3000`.*

3. **Expose Local Server via ngrok**:
   In a separate terminal, launch ngrok:
   ```bash
   npx ngrok http 3000
   ```
   *Copy your HTTPS forwarding URL (e.g. `https://a1b2c3d4.ngrok-free.app`).*

4. **Configure Meta Webhook**:
   - Go to [Meta Developers Console](https://developers.facebook.com/) -> Your App -> **WhatsApp** -> **Configuration**.
   - Set **Callback URL** to: `https://a1b2c3d4.ngrok-free.app/webhook`
   - Set **Verify Token** to match your `.env` value: `sayve_webhook_secret_token`
   - Click **Verify and Save**.
   - Under **Webhook Fields**, subscribe to **`messages`**.

---

### 3. Running Unit Tests

Run unit tests covering message parsing, category classification, correction commands, and currency formatting:

```bash
npm test
```

---

### 4. WhatsApp User Workflow Examples

- **Onboarding Flow**:
  - *User*: "Hello"
  - *Sayve*: "Welcome to Sayve! What is the name of your business?"
  - *User*: "Kemi Groceries"
  - *Sayve*: "Nice to meet you! What currency do you use? (Reply NGN for ₦ Naira...)"
  - *User*: "NGN"

- **Logging Income**:
  - *User*: *"sold 3 bags of rice for 45000"*
  - *Sayve*: *"✅ Logged: ₦45,000 income — Sales (sold 3 bags of rice for 45000)."*

- **Logging Expense**:
  - *User*: *"spent 5000 on transport"*
  - *Sayve*: *"✅ Logged: ₦5,000 expense — Transport (spent 5000 on transport)."*

- **Category Correction**:
  - *User*: *"no, it's Rent"*
  - *Sayve*: *"✏️ Category updated for spent 5000 on transport from Transport ➡️ Rent."*

- **Financial Summary Query**:
  - *User*: *"how much did I make this week"*
  - *Sayve*: Returns formatted text breakdown of Total Income, Total Expenses, Net Profit, and category breakdown for the current week.

- **Data CSV Export**:
  - *User*: *"send my report"*
  - *Sayve*: Generates and sends a 30-day transaction CSV document attachment.

- **Voice Note**:
  - *User*: 🎙️ Records a voice note: *"I sell garri today, two mudu na 1200. Buy fuel for gen, 5k."*
  - *Sayve*: *"🎙️ Got your voice note! Transcribing..."* → transcribes with Groq Whisper → parses with LLM → *"✅ Logged: ₦1,200 income — Sales | ₦5,000 expense — Transport"*

- **Help Command**:
  - *User*: *"help"*
  - *Sayve*: Returns a formatted list of all supported commands.

---

## ☁️ Deployment (Render / Railway)

1. Push code to GitHub repository.
2. Create a new Web Service on Render or Railway pointing to your repository.
3. Set Build Command: `npm run build`
4. Set Start Command: `npm start`
5. Add all Environment Variables in the hosting dashboard.
6. Update Meta Developer App Webhook Callback URL to your production HTTPS URL (`https://your-app.onrender.com/webhook`).
