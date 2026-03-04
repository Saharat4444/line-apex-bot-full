require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const app = express();
app.use(express.json());

const APEX_URL = process.env.APEX_URL;

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
   APEX LOGGING
===================================================== */
async function logToApex(userId, message, reply) {
  try {
    await axios.post(APEX_URL, {
      user_id:  userId,
      message:  message,
      reply:    reply
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
  } catch (err) {
    console.error('APEX Log Error:', err.message);
    // ไม่ throw เพราะ log error ไม่ควรทำให้ bot พัง
  }
}

/* =====================================================
   DIALOGFLOW CONFIG
===================================================== */
const authFlex = new GoogleAuth({
  keyFile: './service-account-FlexCard.json',
  scopes: 'https://www.googleapis.com/auth/dialogflow'
});

const authFAQ = new GoogleAuth({
  keyFile: './service-account.json',
  scopes: 'https://www.googleapis.com/auth/dialogflow'
});

/* =====================================================
   DETECT INTENT
===================================================== */
async function detectIntent(projectId, authClient, text, sessionId, languageCode) {
  try {
    const client = await authClient.getClient();
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

    return response.data.queryResult;

  } catch (err) {
    logError(err);
    throw err;
  }
}

/* =====================================================
   HELPERS
===================================================== */
function isValidContainer(container) {
  return /^[A-Z]{4}[0-9]{7}$/.test(container);
}

function injectData(template, data) {
  let jsonStr = JSON.stringify(template);
  Object.keys(data).forEach(key => {
    jsonStr = jsonStr.replace(new RegExp(`{{${key}}}`, "g"), data[key]);
  });
  return JSON.parse(jsonStr);
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

async function replyFlex(replyToken, flexJson) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{
        type: "flex",
        altText: "Container Result",
        contents: flexJson
      }]
    },
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

    // --- Postback ---
    if (event.type === 'postback') {
      const params = new URLSearchParams(event.postback.data);
      const action = params.get("action");

      if (action === "container") {
        await replyText(event.replyToken, "กรุณาพิมพ์หมายเลขตู้ เช่น ABCU1234567");
        await logToApex(sessionId, '[POSTBACK:container]', 'กรุณาพิมพ์หมายเลขตู้');
      }
      return res.sendStatus(200);
    }

    if (event.type !== 'message' || event.message.type !== 'text')
      return res.sendStatus(200);

    const rawText = event.message.text.trim().toUpperCase();
    log("USER TEXT", rawText);

    // --- Container ---
    const containerMatch = rawText.match(/[A-Z]{4}[0-9]{7}/);
    if (containerMatch) {
      const containerNo = containerMatch[0];

      if (!isValidContainer(containerNo)) {
        await replyText(event.replyToken, "รูปแบบหมายเลขตู้ไม่ถูกต้อง");
        await logToApex(sessionId, rawText, 'รูปแบบหมายเลขตู้ไม่ถูกต้อง');
        return res.sendStatus(200);
      }

      let templateFile, mockData;

      if (containerNo.startsWith("ABCU")) {
        templateFile = "flex_container_import.json";
        mockData = {
          container_no: containerNo,
          category: "IMPORT", size: "20/DR", status: "Full",
          location: "YARD", vessel: "OOCL America OAE", voyage: "190N",
          line: "WHL", bill: "IMP112233", booking_no: "-",
          home_berthing: "C1C2", hold_status: "None",
          pvb: "26-JAN-2026 23:59:59"
        };
      } else if (containerNo.startsWith("DEFU")) {
        templateFile = "flex_container_export.json";
        mockData = {
          container_no: containerNo,
          category: "EXPORT", size: "40/HC", status: "Loaded",
          location: "PORT", vessel: "OOCL Hong Kong", voyage: "220E",
          line: "WHL", bill: "EXP998877", booking_no: "BK-EXP-001",
          home_berthing: "A3", hold_status: "None",
          pvb: "15-FEB-2026 18:00:00"
        };
      } else {
        await replyText(event.replyToken, "รองรับเฉพาะ ABCU / DEFU เท่านั้น");
        await logToApex(sessionId, rawText, 'รองรับเฉพาะ ABCU / DEFU เท่านั้น');
        return res.sendStatus(200);
      }

      const template = JSON.parse(fs.readFileSync(path.join(__dirname, templateFile), "utf8"));
      const finalFlex = injectData(template, mockData);
      await replyFlex(event.replyToken, finalFlex);
      await logToApex(sessionId, rawText, '[FLEX CARD: ' + containerNo + ']');
      return res.sendStatus(200);
    }

    // --- Dialogflow ---
    const cluResult = await detectIntent(
      "project-chatbot-oacy", authFlex,
      rawText, sessionId, "en"
    );

    if (cluResult.intentDetectionConfidence >= 0.6 && cluResult.fulfillmentText) {
      await replyText(event.replyToken, cluResult.fulfillmentText);
      await logToApex(sessionId, rawText, cluResult.fulfillmentText);
      return res.sendStatus(200);
    }

    const faqResult = await detectIntent(
      "project-chatbot-faqs-hpqt", authFAQ,
      rawText, sessionId, "th"
    );

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
  console.log("🚀 Bot running");
});
