require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

const app = express();
app.use(express.json());

const APEX_FLEXCARD_URL = 'https://oracleapex.com/ords/line/linebot/flexcard';

/* =====================================================
   LOGGER
===================================================== */
function log(title, data = null) {
  console.log("\n===============================");
  console.log(`🔎 ${title}`);
  if (data) console.log(JSON.stringify(data, null, 2));
  console.log("===============================\n");
}

function logError(error) {
  console.log("\n❌ ERROR ======================");
  console.log(error.response?.data || error.message);
  console.log("===============================\n");
}

/* =====================================================
   APEX LOGGING (ปิดไว้ — Cloudflare จัดการแทน)
===================================================== */
async function logToApex(userId, message, reply) {
  return;
}

/* =====================================================
   DIALOGFLOW CONFIG
===================================================== */
const authFlex = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_FLEX),
  scopes: 'https://www.googleapis.com/auth/dialogflow'
});

const authFAQ = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_FAQ),
  scopes: 'https://www.googleapis.com/auth/dialogflow'
});

/* =====================================================
   DETECT INTENT
===================================================== */
async function detectIntent(projectId, authClient, text, sessionId, languageCode) {
  try {
    log("DIALOGFLOW REQUEST", { projectId, sessionId, languageCode, text });

    const client      = await authClient.getClient();
    const accessToken = await client.getAccessToken();

    const response = await axios.post(
      `https://dialogflow.googleapis.com/v2/projects/${projectId}/agent/sessions/${sessionId}:detectIntent`,
      { queryInput: { text: { text, languageCode } } },
      {
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          "Content-Type": "application/json"
        }
      }
    );

    log("DIALOGFLOW RAW RESPONSE", response.data);

    const result = response.data.queryResult;

    log("DIALOGFLOW SUMMARY", {
      intent:      result.intent?.displayName,
      confidence:  result.intentDetectionConfidence,
      fulfillment: result.fulfillmentText,
      parameters:  result.parameters
    });

    return result;

  } catch (err) {
    logError(err);
    throw err;
  }
}

/* =====================================================
   LINE REPLY
===================================================== */
async function replyText(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages: [{ type: "text", text }] },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

/* =====================================================
   WEBHOOK
===================================================== */
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events?.[0];
    if (!event) return res.sendStatus(200);

    log("EVENT RECEIVED", event);

    const sessionId = event.source.userId;

    // Postback — Cloudflare จัดการแทนแล้ว
    if (event.type === 'postback') return res.sendStatus(200);

    if (event.type !== 'message' || event.message.type !== 'text')
      return res.sendStatus(200);

    const rawText = event.message.text.trim().toUpperCase();
    log("USER TEXT", rawText);

    // --- Container → ส่งไป APEX จัดการแทน ---
    const containerMatch = rawText.match(/[A-Z]{4}[0-9]{7}/);
    if (containerMatch) {
      const containerNo = containerMatch[0];
      log("CONTAINER → APEX FLEXCARD", containerNo);

      axios.post(APEX_FLEXCARD_URL, {
        container_no: containerNo,
        reply_token:  event.replyToken,
        user_id:      sessionId
      }, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
      }).catch(err => {
        console.error("APEX Flexcard Error:", err.message);
      });

      return res.sendStatus(200);
    }

    // --- Dialogflow Flex/Container Intent ---
    const cluResult = await detectIntent(
      "project-chatbot-oacy", authFlex,
      rawText, sessionId, "en"
    );

    log("CLU RESULT", {
      intent:      cluResult.intent?.displayName,
      confidence:  cluResult.intentDetectionConfidence,
      fulfillment: cluResult.fulfillmentText
    });

    if (cluResult.intentDetectionConfidence >= 0.6 && cluResult.fulfillmentText) {
      await replyText(event.replyToken, cluResult.fulfillmentText);
      await logToApex(sessionId, rawText, cluResult.fulfillmentText);
      return res.sendStatus(200);
    }

    // --- Dialogflow FAQ ---
    const faqResult = await detectIntent(
      "project-chatbot-faqs-hpqt", authFAQ,
      rawText, sessionId, "th"
    );

    log("FAQ RESULT", {
      intent:      faqResult.intent?.displayName,
      confidence:  faqResult.intentDetectionConfidence,
      fulfillment: faqResult.fulfillmentText
    });

    const faqAnswer = faqResult.fulfillmentText || "ไม่พบข้อมูลที่เกี่ยวข้อง";
    await replyText(event.replyToken, faqAnswer);
    await logToApex(sessionId, rawText, faqAnswer);
    return res.sendStatus(200);

  } catch (err) {
    logError(err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Bot running on port 3000");
});
