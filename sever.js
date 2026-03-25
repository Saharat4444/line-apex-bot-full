require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

// ดึง Flex Card ทั้งหมดจาก flexCards.js
// ถ้าอยากเพิ่มการ์ดใหม่ → ไปแก้ที่ flexCards.js
const {
  buildContainerFlex,
  buildBookingFlex,
  buildVesselFlex,
  buildSurveyFlex
} = require('./flexCards');

const app = express();
app.use(express.json());

const APEX_BASE = 'https://uatonline.hutchisonports.co.th/hptuat/api/linebot';

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

async function detectIntent(projectId, authClient, text, sessionId, languageCode) {
  try {
    const client = await authClient.getClient();
    const accessToken = await client.getAccessToken();
    const response = await axios.post(
      `https://dialogflow.googleapis.com/v2/projects/${projectId}/agent/sessions/${sessionId}:detectIntent`,
      { queryInput: { text: { text, languageCode } } },
      { headers: { Authorization: `Bearer ${accessToken.token}`, "Content-Type": "application/json" } }
    );
    const result = response.data.queryResult;
    log("DIALOGFLOW SUMMARY", {
      intent:      result.intent?.displayName,
      confidence:  result.intentDetectionConfidence,
      fulfillment: result.fulfillmentText
    });
    return result;
  } catch (err) { logError(err); throw err; }
}

function isFallback(result) {
  return (result.intent?.displayName || '').toLowerCase().includes('fallback');
}

/* =====================================================
   DETECT SEARCH TYPE
===================================================== */
function detectSearchType(text) {
  const upper = text.toUpperCase().trim();

  // Container: 4 ตัวอักษร + 7 ตัวเลข
  const containerMatch = upper.match(/\b([A-Z]{4}[0-9]{7})\b/);
  if (containerMatch) return { type: 'container', value: containerMatch[1] };

  // Vessel: "เรือ xxx" หรือ "vessel xxx" (มี prefix)
  if (/^(เรือ|vessel)\s+/i.test(text.trim())) {
    const shipName = text.trim().replace(/^(เรือ|vessel)\s+/i, '').trim();
    if (shipName) return { type: 'vessel', value: shipName };
  }

  // Booking/BL: "booking xxx" หรือ "bl xxx" (มี prefix)
  if (/^(booking|bl)\s+/i.test(text.trim())) {
    const bookNo = text.trim().replace(/^(booking|bl)\s+/i, '').trim();
    if (bookNo) return { type: 'booking', value: bookNo };
  }

  // Booking pattern: ตัวอักษร 2-4 ตัว + ตัวเลข 6-10 ตัว (ไม่มีช่องว่าง)
  const bookingMatch = upper.match(/^([A-Z]{2,4}[0-9]{6,10})$/);
  if (bookingMatch) return { type: 'booking', value: bookingMatch[1] };

  // Vessel: ถ้าข้อความเป็นตัวอังกฤษล้วน (+ ช่องว่าง ตัวเลข /)
  // เช่น "NANHIRUN", "EVER BRAVE", "NP LOVEGISTICS 1", "RACHA BHUM"
  // pattern: มีแต่ A-Z ช่องว่าง ตัวเลข และ / ความยาว 3+ ตัว
  // ไม่มีภาษาไทยเลย → น่าจะเป็นชื่อเรือ
  if (/^[A-Z0-9 /]{3,}$/.test(upper) && /[A-Z]{2,}/.test(upper)) {
    return { type: 'vessel', value: text.trim() };
  }

  return { type: 'dialogflow', value: text };
}

/* =====================================================
   FETCH FROM APEX
===================================================== */
async function fetchApex(endpoint) {
  try {
    const url = `${APEX_BASE}/${endpoint}`;
    log("APEX REQUEST", url);
    const resp = await axios.get(url, { timeout: 8000 });
    return resp.data;
  } catch (err) { logError(err); return null; }
}

function getFirstItem(apexData) {
  if (!apexData) return null;
  if (Array.isArray(apexData.items) && apexData.items.length > 0) return apexData.items[0];
  if (Array.isArray(apexData) && apexData.length > 0) return apexData[0];
  return null;
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

async function replyFlex(replyToken, altText, flexJson) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages: [{ type: "flex", altText, contents: flexJson }] },
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

    // --- Postback ---
    if (event.type === 'postback') {
      const params = new URLSearchParams(event.postback.data);
      const action  = params.get("action");

      // กดปุ่ม "Check Booking" จาก Container card → ค้น Booking ทันที
      if (action === 'lookup_booking') {
        const bookingNo = params.get("value");
        if (bookingNo) {
          const data = await fetchApex(`booking/${encodeURIComponent(bookingNo)}`);
          const item = getFirstItem(data);
          if (!item) {
            await replyText(event.replyToken, `ไม่พบข้อมูล Booking ${bookingNo} ในระบบ`);
          } else {
            await replyFlex(event.replyToken, `Booking: ${bookingNo}`, buildBookingFlex(item));
          }
        }
        return res.sendStatus(200);
      }

      // กดปุ่ม "Cost Estimate" จาก Rich Menu → เปลี่ยนเป็นแสดง Survey
      // action=cost มาจาก Rich Menu เดิม ไม่มี refId
      if (action === 'cost') {
        await replyFlex(event.replyToken, 'ประเมินความพอใจ', buildSurveyFlex(''));
        return res.sendStatus(200);
      }

      // กดปุ่ม "ประเมินความพอใจ" จาก Card → มี refId (หมายเลขตู้ / booking)
      if (action === 'survey') {
        const refId = params.get("ref") || '';
        await replyFlex(event.replyToken, 'ประเมินความพอใจ', buildSurveyFlex(refId));
        return res.sendStatus(200);
      }

      // กดดาว → บันทึกลง APEX → ตอบขอบคุณ
      if (action === 'rate') {
        const score = params.get("score");
        const ref   = params.get("ref") || '';
        const stars = '⭐'.repeat(Number(score));
        try {
          await axios.post(
            `${APEX_BASE}/survey`,
            { user_id: sessionId, score, ref_id: ref },
            { headers: { "Content-Type": "application/json" }, timeout: 5000 }
          );
        } catch (e) { logError(e); }
        await replyText(event.replyToken,
          `${stars}\nขอบคุณสำหรับการประเมิน!\nคะแนนของคุณ: ${score}/5`
        );
        return res.sendStatus(200);
      }

      // ปุ่ม "Check another xxx" → แนะนำให้พิมพ์ใหม่
      const hints = {
        container: "กรุณาพิมพ์หมายเลขตู้ เช่น ABCU1234567",
        booking:   "กรุณาพิมพ์ booking แล้วตามด้วยเลข\nเช่น booking BKK12345678",
        vessel:    "กรุณาพิมพ์ เรือ แล้วตามด้วยชื่อเรือ\nเช่น เรือ Nanhirun"
      };
      await replyText(event.replyToken, hints[action] || "กรุณาพิมพ์ข้อความ");
      return res.sendStatus(200);
    }

    if (event.type !== 'message' || event.message.type !== 'text')
      return res.sendStatus(200);

    const originalText = event.message.text.trim();
    log("USER TEXT", originalText);

    const search = detectSearchType(originalText);
    log("SEARCH TYPE", search);

    // ---- CONTAINER ----
    if (search.type === 'container') {
      const data = await fetchApex(`container/${encodeURIComponent(search.value)}`);
      const item = getFirstItem(data);
      if (!item) {
        await replyText(event.replyToken, `ไม่พบข้อมูลตู้ ${search.value} ในระบบ`);
      } else {
        await replyFlex(event.replyToken, `Container: ${search.value}`, buildContainerFlex(item));
      }
      return res.sendStatus(200);
    }

    // ---- BOOKING ----
    if (search.type === 'booking') {
      const data = await fetchApex(`booking/${encodeURIComponent(search.value)}`);
      const item = getFirstItem(data);
      if (!item) {
        await replyText(event.replyToken, `ไม่พบข้อมูล Booking ${search.value} ในระบบ`);
      } else {
        await replyFlex(event.replyToken, `Booking: ${search.value}`, buildBookingFlex(item));
      }
      return res.sendStatus(200);
    }

    // ---- VESSEL ----
    if (search.type === 'vessel') {
      const data = await fetchApex(`vessel/${encodeURIComponent(search.value)}`);
      const item = getFirstItem(data);
      if (!item) {
        await replyText(event.replyToken, `ไม่พบข้อมูลเรือ "${search.value}" ในระบบ`);
      } else {
        await replyFlex(event.replyToken, `Vessel: ${search.value}`, buildVesselFlex(item));
      }
      return res.sendStatus(200);
    }

    // ---- DIALOGFLOW EN ----
    const cluResult = await detectIntent(
      "project-chatbot-oacy", authFlex,
      originalText, sessionId, "en"
    );
    if (cluResult.intentDetectionConfidence >= 0.6 && cluResult.fulfillmentText && !isFallback(cluResult)) {
      await replyText(event.replyToken, cluResult.fulfillmentText);
      return res.sendStatus(200);
    }

    // ---- DIALOGFLOW FAQ TH ----
    const faqResult = await detectIntent(
      "project-chatbot-faqs-hpqt", authFAQ,
      originalText, sessionId, "th"
    );
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
