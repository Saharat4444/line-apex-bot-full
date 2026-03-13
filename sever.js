require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const CONTAINER_DB = require('./containerDB');

const app = express();
app.use(express.json());

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
   FLEX CARD BUILDER
===================================================== */
function buildFlexCard(row) {
  const isImport = row.trans_type === 'IMPORT';
  const size     = [row.size_id, row.type_id, row.height_id].filter(Boolean).join('/') || '-';

  const billLabel = isImport ? 'Bill of Lading :' : 'Booking :';
  const billValue = isImport ? (row.bl_no || '-') : (row.book_no || '-');

  const item = (label, value) => ({
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: label,       size: "sm", color: "#777777", flex: 3 },
      { type: "text", text: value || '-', size: "sm", weight: "bold",  flex: 5, wrap: true }
    ]
  });

  return {
    type: "bubble", size: "mega",
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        { type: "text", text: "Container detail", weight: "bold", size: "md", color: "#333333" },
        { type: "text", text: row.cntr_id, weight: "bold", size: "xxl", margin: "sm", wrap: true },
        { type: "separator", margin: "md" },
        {
          type: "box", layout: "vertical", margin: "md", spacing: "sm",
          contents: [
            item("Sz/Ty/Ht :",      size),
            item("Category :",      row.trans_type),
            item("Status :",        row.status),
            item("Location :",      row.loc),
            item("Vessel :",        row.vessel),
            item("Voyage :",        row.voyage),
            item("Line :",          row.line_id),
            item(billLabel,         billValue),
            item("Home Berthing :", row.home_berth_tml),
            item("Hold Status :",   row.account_status),
            item("PVB :",           row.valid_before),
          ]
        }
      ]
    },
    footer: {
      type: "box", layout: "vertical",
      contents: [{
        type: "button", style: "secondary",
        action: { type: "postback", label: "Check another container", data: "action=container" }
      }]
    }
  };
}

/* =====================================================
   LINE REPLY
===================================================== */
async function replyText(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
  );
}

async function replyFlex(replyToken, flexJson) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages: [{ type: "flex", altText: "Container Result", contents: flexJson }] },
    { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
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

    // Postback
    if (event.type === 'postback') {
      const params = new URLSearchParams(event.postback?.data);
      if (params.get('action') === 'container') {
        await replyText(event.replyToken, 'กรุณาพิมพ์หมายเลขตู้ เช่น WHSU4035362');
      }
      return res.sendStatus(200);
    }

    if (event.type !== 'message' || event.message.type !== 'text')
      return res.sendStatus(200);

    const rawText = event.message.text.trim();
    log("USER TEXT", rawText);

    // --- Container → ดึงจาก containerDB.js ---
    const containerMatch = rawText.toUpperCase().match(/[A-Z]{4}[0-9]{7}/);
    if (containerMatch) {
      const containerNo = containerMatch[0];
      log("CONTAINER LOOKUP", containerNo);

      const row = CONTAINER_DB[containerNo];

      if (!row) {
        await replyText(event.replyToken, `ไม่พบข้อมูลตู้ ${containerNo} ในระบบ`);
      } else {
        const flexJson = buildFlexCard(row);
        await replyFlex(event.replyToken, flexJson);
      }
      return res.sendStatus(200);
    }

    // --- Dialogflow Flex/Container Intent ---
    const cluResult = await detectIntent(
      "project-chatbot-oacy", authFlex,
      rawText.toUpperCase(), sessionId, "en"
    );

    log("CLU RESULT", {
      intent:      cluResult.intent?.displayName,
      confidence:  cluResult.intentDetectionConfidence,
      fulfillment: cluResult.fulfillmentText
    });

    if (cluResult.intentDetectionConfidence >= 0.6 && cluResult.fulfillmentText) {
      await replyText(event.replyToken, cluResult.fulfillmentText);
      return res.sendStatus(200);
    }

    // --- Dialogflow FAQ ---
    const faqResult = await detectIntent(
      "project-chatbot-faqs-hpqt", authFAQ,
      rawText.toUpperCase(), sessionId, "th"
    );

    log("FAQ RESULT", {
      intent:      faqResult.intent?.displayName,
      confidence:  faqResult.intentDetectionConfidence,
      fulfillment: faqResult.fulfillmentText
    });

    const faqAnswer = faqResult.fulfillmentText || "ไม่พบข้อมูลที่เกี่ยวข้อง";
    await replyText(event.replyToken, faqAnswer);
    return res.sendStatus(200);

  } catch (err) {
    logError(err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Bot running on port 3000");
});
